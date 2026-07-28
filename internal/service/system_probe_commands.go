package service

const systemInfoCommand = `LC_ALL=C
export LC_ALL

emit_disk() {
  df -Pk / 2>/dev/null | awk 'NR == 2 {printf "DISK %.0f %.0f\n", $3 * 1024, $2 * 1024; found = 1} END {if (!found) print "DISK 0 0"}'
}

emit_cpu_count() {
  count="$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null || awk '/^processor[[:space:]]*:/ {count++} END {print count}' /proc/cpuinfo 2>/dev/null)"
  case "$count" in ''|*[!0-9]*|0) count=1 ;; esac
  printf 'CPUCOUNT %s\n' "$count"
}

emit_linux() {
  awk '{print "LOAD", $1, $2, $3}' /proc/loadavg 2>/dev/null || printf 'LOAD 0 0 0\n'
  awk '{print "UPTIME", $1}' /proc/uptime 2>/dev/null || printf 'UPTIME 0\n'
  printf 'KERNEL '
  uname -r 2>/dev/null || printf 'unknown\n'
  awk '/^cpu / {print "CPU", $2+$3+$4+$5+$6+$7+$8+$9, $5+$6; found=1; exit} END {if (!found) print "CPU 0 0"}' /proc/stat 2>/dev/null
  awk '
    /^MemTotal:/ {total=$2*1024}
    /^MemAvailable:/ {available=$2*1024; has_available=1}
    /^MemFree:/ {free=$2}
    /^Buffers:/ {buffers=$2}
    /^Cached:/ {cached=$2}
    /^SwapTotal:/ {swap_total=$2*1024}
    /^SwapFree:/ {swap_free=$2*1024}
    END {
      if (!has_available) available=(free+buffers+cached)*1024
      if (available > total) available=total
      printf "MEMTOTAL %.0f\nMEMAVAILABLE %.0f\nSWAPTOTAL %.0f\nSWAPFREE %.0f\n", total, available, swap_total, swap_free
    }' /proc/meminfo 2>/dev/null
  awk 'NR > 2 {rx+=$2; tx+=$10} END {printf "NET %.0f %.0f\n", rx, tx}' /proc/net/dev 2>/dev/null
  emit_disk
  emit_cpu_count
  if [ -r /etc/os-release ]; then
    awk -F= '/^PRETTY_NAME=/ {value=substr($0,index($0,"=")+1); sub(/^"/,"",value); sub(/"$/,"",value); print "OS",value; found=1; exit} END {if (!found) print "OS Linux"}' /etc/os-release
  else
    printf 'OS Linux\n'
  fi
}

emit_darwin() {
  sysctl -n vm.loadavg 2>/dev/null | tr -d '{}' | awk 'NF >= 3 {print "LOAD", $1, $2, $3; found=1} END {if (!found) print "LOAD 0 0 0"}'
  boot_time="$(sysctl -n kern.boottime 2>/dev/null | awk -F'[=,]' '{value=$2; gsub(/[^0-9]/,"",value); print value; exit}')"
  now="$(date +%s 2>/dev/null)"
  case "$boot_time:$now" in *[!0-9:]*|:*) uptime=0 ;; *) uptime=$((now - boot_time)) ;; esac
  if [ "$uptime" -lt 0 ] 2>/dev/null; then uptime=0; fi
  printf 'UPTIME %s\n' "$uptime"
  printf 'KERNEL '
  uname -r 2>/dev/null || printf 'unknown\n'
  top -l 1 -n 0 2>/dev/null | awk -F'[:,% ]+' '/CPU usage/ {value=$3+$5; if (value < 0) value=0; if (value > 100) value=100; print "CPUPERCENT", value; found=1; exit} END {if (!found) print "CPUPERCENT 0"}'
  memory_total="$(sysctl -n hw.memsize 2>/dev/null)"
  case "$memory_total" in ''|*[!0-9]*) memory_total=0 ;; esac
  vm_stat 2>/dev/null | awk -v total="$memory_total" '
    /page size of/ {page=$8; gsub(/[^0-9]/,"",page)}
    /^Pages free:/ {free=$3; gsub(/[^0-9]/,"",free)}
    /^Pages inactive:/ {inactive=$3; gsub(/[^0-9]/,"",inactive)}
    /^Pages speculative:/ {speculative=$3; gsub(/[^0-9]/,"",speculative)}
    END {available=(free+inactive+speculative)*page; if (available > total) available=total; printf "MEMTOTAL %.0f\nMEMAVAILABLE %.0f\n", total, available}'
  sysctl -n vm.swapusage 2>/dev/null | awk '
    function bytes(value, amount, unit) {amount=value+0; unit=substr(value,length(value),1); if (unit=="K") return amount*1024; if (unit=="M") return amount*1048576; if (unit=="G") return amount*1073741824; if (unit=="T") return amount*1099511627776; return amount}
    {for (position=1; position<=NF; position++) {if ($position=="total") total=bytes($(position+2)); if ($position=="free") free=bytes($(position+2))}}
    END {printf "SWAPTOTAL %.0f\nSWAPFREE %.0f\n", total, free}'
  netstat -ibdn 2>/dev/null | awk 'NR > 1 && $1 != "lo0" && !seen[$1]++ && $7 ~ /^[0-9]+$/ && $10 ~ /^[0-9]+$/ {rx+=$7; tx+=$10} END {printf "NET %.0f %.0f\n", rx, tx}'
  emit_disk
  count="$(sysctl -n hw.ncpu 2>/dev/null)"
  case "$count" in ''|*[!0-9]*|0) emit_cpu_count ;; *) printf 'CPUCOUNT %s\n' "$count" ;; esac
  product="$(sw_vers -productName 2>/dev/null)"
  version="$(sw_vers -productVersion 2>/dev/null)"
  if [ -n "$product$version" ]; then printf 'OS %s %s\n' "$product" "$version"; else printf 'OS macOS\n'; fi
}

emit_portable() {
  printf 'LOAD 0 0 0\n'
  printf 'UPTIME 0\n'
  printf 'KERNEL '
  uname -r 2>/dev/null || printf 'unknown\n'
  printf 'CPUPERCENT 0\n'
  printf 'MEMTOTAL 0\n'
  printf 'MEMAVAILABLE 0\n'
  printf 'SWAPTOTAL 0\n'
  printf 'SWAPFREE 0\n'
  printf 'NET 0 0\n'
  emit_disk
  emit_cpu_count
  printf 'OS '
  uname -s 2>/dev/null || printf 'Unix\n'
}

case "$(uname -s 2>/dev/null)" in
  Linux) emit_linux ;;
  Darwin) emit_darwin ;;
  *) emit_portable ;;
esac`

const processInfoCommand = `LC_ALL=C
export LC_ALL
if ps -eo pid=,ppid=,user=,state=,%cpu=,rss=,comm= >/dev/null 2>&1; then
  exec ps -eo pid=,ppid=,user=,state=,%cpu=,rss=,comm=
fi
if ps ax -o pid=,ppid=,user=,state=,%cpu=,rss=,comm= >/dev/null 2>&1; then
  exec ps ax -o pid=,ppid=,user=,state=,%cpu=,rss=,comm=
fi
if ps -o pid,ppid,user,stat,rss,comm >/dev/null 2>&1; then
  ps -o pid,ppid,user,stat,rss,comm | awk 'NR > 1 {print $1, $2, $3, substr($4,1,1), 0, $5, $6}'
  exit 0
fi
if ps -o pid,ppid,user,stat,vsz,comm >/dev/null 2>&1; then
  ps -o pid,ppid,user,stat,vsz,comm | awk 'NR > 1 {print $1, $2, $3, substr($4,1,1), 0, $5, $6}'
  exit 0
fi
if ps -ef >/dev/null 2>&1; then
  ps -ef | awk 'NR > 1 && NF >= 8 {command=$8; for (position=9; position<=NF; position++) command=command " " $position; print $2, $3, $1, "?", 0, 0, command}'
  exit 0
fi
exit 1`
