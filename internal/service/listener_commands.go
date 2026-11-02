package service

const listeningPortsCommand = `LC_ALL=C
export LC_ALL
if command -v ss >/dev/null 2>&1; then
  if output="$(ss -H -lntup 2>/dev/null)"; then
    printf '%s\n' "$output" | awk '
      NF >= 6 {
        process = ""
        if (NF >= 7) {
          process = $7
          for (position = 8; position <= NF; position++) process = process " " $position
        }
        printf "PORT\t%s\t%s\t%s\n", $1, $5, process
      }'
    exit 0
  fi
fi
if command -v netstat >/dev/null 2>&1; then
  if output="$(netstat -lntup 2>/dev/null)"; then
    printf '%s\n' "$output" | awk '
      $1 ~ /^(tcp|udp)/ && NF >= 7 {
        process = $7
        for (position = 8; position <= NF; position++) process = process " " $position
        printf "PORT\t%s\t%s\t%s\n", $1, $4, process
      }'
    exit 0
  fi
fi
if command -v lsof >/dev/null 2>&1; then
  lsof -nP -iTCP -sTCP:LISTEN -F pcn 2>/dev/null | awk '
    /^p/ {pid=substr($0,2)}
    /^c/ {name=substr($0,2)}
    /^n/ {address=substr($0,2); if (address != "") printf "PORT\ttcp\t%s\t%s/%s\n", address, pid, name}
  '
  exit 0
fi
exit 1`
