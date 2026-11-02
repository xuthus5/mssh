package service

const systemInfoCommand = `LC_ALL=C
export LC_ALL

protocol_header() {
  source_name="$1"
  monotonic_ms=0
  if [ "$source_name" = "linux-procfs" ]; then
    monotonic_ms="$(awk '{printf "%.0f", $1 * 1000}' /proc/uptime 2>/dev/null)"
    case "$monotonic_ms" in ''|*[!0-9]*) monotonic_ms=0 ;; esac
  fi
  epoch_ms="$(date +%s 2>/dev/null)"
  case "$epoch_ms" in ''|*[!0-9]*) epoch_ms=0 ;; *) epoch_ms=$((epoch_ms * 1000)) ;; esac
  printf 'SCHEMA 1\nSOURCE %s\nSAMPLE %s %s\n' "$source_name" "$epoch_ms" "$monotonic_ms"
}

emit_disks() {
  df -Pk 2>/dev/null | awk 'function escape(value) {gsub(/ /, "\\040", value); return value}
  NR > 1 {
    device = $1
    mount = $6
    for (position = 7; position <= NF; position++) mount = mount " " $position
    if (device ~ /^(tmpfs|devtmpfs|proc|procfs|sysfs|cgroup.*|mqueue|shm|ramfs|none|map|devfs|udev|autofs|debugfs|tracefs|securityfs|pstore|bpf|hugetlbfs|configfs|fusectl|binfmt_misc)$/) next
    used = $3 * 1024
    total = $2 * 1024
    available = $4 * 1024
    printf "DISKMOUNT %s %s %.0f %.0f %.0f\n", escape(device), escape(mount), used, total, available
    if (mount == "/") printf "DISK %.0f %.0f\n", used, total
  }'
}

emit_cpu_count() {
  count="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || awk '/^processor[[:space:]]*:/ {count++} END {print count}' /proc/cpuinfo 2>/dev/null)"
  case "$count" in ''|*[!0-9]*|0) return ;; esac
  printf 'CPUCOUNT %s\n' "$count"
}

emit_linux() {
  protocol_header linux-procfs
  awk '{printf "LOAD %s %s %s\n", $1, $2, $3}' /proc/loadavg 2>/dev/null
  awk '{printf "UPTIME %.0f\n", $1}' /proc/uptime 2>/dev/null
  printf 'KERNEL '
  uname -r 2>/dev/null || printf 'unknown\n'
  awk '/^cpu / {total=0; for (i=2; i<=9; i++) total+=$i; printf "CPU %.0f %.0f\nIOWAIT %.0f\n", total, $5, $6; found=1; exit} END {if (!found) exit 0}' /proc/stat 2>/dev/null
  awk '
    /^MemTotal:/ {total=$2*1024}
    /^MemAvailable:/ {available=$2*1024; has_available=1}
    /^MemFree:/ {free=$2}
    /^Buffers:/ {buffers=$2}
    /^Cached:/ {cached=$2}
    /^SwapTotal:/ {swap_total=$2*1024}
    /^SwapFree:/ {swap_free=$2*1024}
    END {
      if (total <= 0) exit 0
      if (!has_available) available=(free+buffers+cached)*1024
      if (available > total) available=total
      printf "MEMTOTAL %.0f\nMEMAVAILABLE %.0f\nSWAPTOTAL %.0f\nSWAPFREE %.0f\n", total, available, swap_total, swap_free
    }' /proc/meminfo 2>/dev/null
  awk 'NR > 2 {name=$1; sub(/:$/, "", name); printf "NETIF %s %.0f %.0f\n", name, $2, $10}' /proc/net/dev 2>/dev/null
  emit_disks
  emit_cpu_count
  if [ -r /etc/os-release ]; then
    awk -F= '/^PRETTY_NAME=/ {value=substr($0,index($0,"=")+1); sub(/^"/,"",value); sub(/"$/,"",value); print "OS",value; found=1; exit} END {if (!found) print "OS Linux"}' /etc/os-release
  else
    printf 'OS Linux\n'
  fi
}

emit_darwin() {
  protocol_header darwin-sysctl
  sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | awk 'NF >= 3 {print "LOAD", $1, $2, $3; found=1} END {if (!found) exit 0}'
  boot_time="$(sysctl -n kern.boottime 2>/dev/null | awk -F'[=,]' '{value=$2; gsub(/[^0-9]/,"",value); print value; exit}')"
  now="$(date +%s 2>/dev/null)"
  case "$boot_time:$now" in *[!0-9:]*|:*) uptime=0 ;; *) uptime=$((now - boot_time)) ;; esac
  if [ "$uptime" -lt 0 ] 2>/dev/null; then uptime=0; fi
  printf 'UPTIME %s\n' "$uptime"
  printf 'KERNEL '
  uname -r 2>/dev/null || printf 'unknown\n'
  top -l 1 -n 0 2>/dev/null | awk -F'[:,% ]+' '/CPU usage/ {value=$3+$5; if (value < 0) value=0; if (value > 100) value=100; print "CPUPERCENT", value; found=1; exit} END {if (!found) exit 0}'
  memory_total="$(sysctl -n hw.memsize 2>/dev/null)"
  case "$memory_total" in ''|*[!0-9]*) memory_total=0 ;; esac
  vm_stat 2>/dev/null | awk -v total="$memory_total" '
    /page size of/ {page=$8; gsub(/[^0-9]/,"",page)}
    /^Pages free:/ {free=$3; gsub(/[^0-9]/,"",free)}
    /^Pages inactive:/ {inactive=$3; gsub(/[^0-9]/,"",inactive)}
    /^Pages speculative:/ {speculative=$3; gsub(/[^0-9]/,"",speculative)}
    END {if (total <= 0) exit 0; available=(free+inactive+speculative)*page; if (available > total) available=total; printf "MEMTOTAL %.0f\nMEMAVAILABLE %.0f\n", total, available}'
  sysctl -n vm.swapusage 2>/dev/null | awk '
    function bytes(value, amount, unit) {amount=value+0; unit=substr(value,length(value),1); if (unit=="K") return amount*1024; if (unit=="M") return amount*1048576; if (unit=="G") return amount*1073741824; if (unit=="T") return amount*1099511627776; return amount}
    {for (position=1; position<=NF; position++) {if ($position=="total") total=bytes($(position+2)); if ($position=="free") free=bytes($(position+2))}}
    END {printf "SWAPTOTAL %.0f\nSWAPFREE %.0f\n", total, free}'
  netstat -ibdn 2>/dev/null | awk 'NR > 1 && !seen[$1]++ && $7 ~ /^[0-9]+$/ && $10 ~ /^[0-9]+$/ {printf "NETIF %s %s %s\n", $1, $7, $10}'
  emit_disks
  count="$(sysctl -n hw.ncpu 2>/dev/null)"
  case "$count" in ''|*[!0-9]*|0) emit_cpu_count ;; *) printf 'CPUCOUNT %s\n' "$count" ;; esac
  product="$(sw_vers -productName 2>/dev/null)"
  version="$(sw_vers -productVersion 2>/dev/null)"
  if [ -n "$product$version" ]; then printf 'OS %s %s\n' "$product" "$version"; else printf 'OS macOS\n'; fi
}

emit_portable() {
  protocol_header portable
  printf 'KERNEL '
  uname -r 2>/dev/null || printf 'unknown\n'
  emit_disks
  emit_cpu_count
  printf 'OS '
  uname -s 2>/dev/null || printf 'Unix\n'
}

case "$(uname -s 2>/dev/null)" in
  Linux) emit_linux ;;
  Darwin) emit_darwin ;;
  *) emit_portable ;;
esac`
