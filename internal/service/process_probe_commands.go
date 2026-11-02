package service

const processInfoCommand = `LC_ALL=C
export LC_ALL
if [ -r /proc/stat ] && [ -d /proc/self ]; then
  if rows="$(ps -eo pid=,ppid=,user=,state=,rss=,args= 2>/dev/null)"; then
    total_ticks="$(awk '/^cpu / {total=0; for (i=2; i<=9; i++) total+=$i; print total; exit}' /proc/stat 2>/dev/null)"
    cpu_count="$(awk '/^cpu[0-9]+[[:space:]]/ {count++} END {print count}' /proc/stat 2>/dev/null)"
    case "$total_ticks" in ''|*[!0-9]*) total_ticks=0 ;; esac
    case "$cpu_count" in ''|*[!0-9]*|0) cpu_count=1 ;; esac
    printf 'SCHEMA 1\nMODE procfs\nCPUCOUNT %s\nCPUTOTAL %s\n' "$cpu_count" "$total_ticks"
    printf '%s\n' "$rows" | while read -r pid ppid user state rss command_text; do
      case "$pid:$ppid:$rss" in ''|*[!0-9:]*|::*) continue ;; esac
      stat_line="$(sed -n '1p' "/proc/$pid/stat" 2>/dev/null)" || continue
      case "$stat_line" in *') '*) ;; *) continue ;; esac
      stat_rest="${stat_line##*) }"
      set -- $stat_rest
      utime="${12:-0}"
      stime="${13:-0}"
      start_ticks="${20:-0}"
      case "$utime:$stime:$start_ticks" in *[!0-9:]*|::*) continue ;; esac
      proc_ticks=$((utime + stime))
      cmdline="$(tr '\000\011' '  ' < "/proc/$pid/cmdline" 2>/dev/null)"
      if [ -n "$cmdline" ]; then command_text="$cmdline"; fi
      printf 'PROC\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$pid" "$ppid" "$user" "$state" "$rss" "$proc_ticks" "$start_ticks" "$command_text"
    done
    exit 0
  fi
fi
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
