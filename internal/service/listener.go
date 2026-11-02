package service

import (
	"fmt"
	"regexp"
	"sort"
	"strconv"
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

var (
	listenerProtocolPattern       = regexp.MustCompile(`^(tcp|udp)[46]?$`)
	listenerSSProcessPattern      = regexp.MustCompile(`"([^"]+)"\s*,\s*pid=([0-9]+)`)
	listenerNetstatProcessPattern = regexp.MustCompile(`^([0-9]+)/(.+)$`)
)

func (t *TerminalService) ListeningPorts(terminalID string) ([]model.ListeningPortInfo, error) {
	if err := validateTerminalID(terminalID); err != nil {
		return nil, err
	}
	finish, err := t.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	sessionID, ok := t.terminalSessionID(terminalID)
	if !ok {
		return nil, fmt.Errorf("terminal %s not found", terminalID)
	}
	wrapper, release, err := t.acquireSystemProbeConnection(sessionID)
	if err != nil {
		return nil, err
	}
	defer release()
	output, err := _runSystemInfoCommand(wrapper, listeningPortsCommand)
	if err != nil {
		return nil, err
	}
	return parseListeningPorts(string(output)), nil
}

func parseListeningPorts(output string) []model.ListeningPortInfo {
	ports := make([]model.ListeningPortInfo, 0)
	for _, line := range strings.Split(output, "\n") {
		if port, ok := parseListeningPort(line); ok {
			ports = append(ports, port)
		}
	}
	sort.SliceStable(ports, func(left, right int) bool {
		if ports[left].Port != ports[right].Port {
			return ports[left].Port < ports[right].Port
		}
		if ports[left].Protocol != ports[right].Protocol {
			return ports[left].Protocol < ports[right].Protocol
		}
		if ports[left].Address != ports[right].Address {
			return ports[left].Address < ports[right].Address
		}
		return ports[left].PID < ports[right].PID
	})
	return ports
}

func parseListeningPort(line string) (model.ListeningPortInfo, bool) {
	fields := strings.Split(strings.TrimSuffix(line, "\r"), "\t")
	if len(fields) < 3 || fields[0] != "PORT" {
		return model.ListeningPortInfo{}, false
	}
	protocol := strings.ToLower(strings.TrimSpace(fields[1]))
	if !listenerProtocolPattern.MatchString(protocol) {
		return model.ListeningPortInfo{}, false
	}
	address, port, ok := splitListeningAddress(fields[2])
	if !ok {
		return model.ListeningPortInfo{}, false
	}
	pid, processName := int64(0), ""
	if len(fields) >= 4 {
		pid, processName = parseListeningProcess(fields[3])
	}
	return model.ListeningPortInfo{
		Protocol: protocol, Address: address, Port: port, PID: pid, ProcessName: processName,
	}, true
}

func splitListeningAddress(value string) (string, int, bool) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", 0, false
	}
	host, portText := "", ""
	if strings.HasPrefix(value, "[") {
		end := strings.IndexByte(value, ']')
		if end < 2 || end+1 >= len(value) || value[end+1] != ':' {
			return "", 0, false
		}
		host, portText = value[1:end], value[end+2:]
	} else {
		separator := strings.LastIndexByte(value, ':')
		if separator <= 0 || separator == len(value)-1 {
			return "", 0, false
		}
		host, portText = value[:separator], value[separator+1:]
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port <= 0 || port > 65535 || strings.TrimSpace(host) == "" {
		return "", 0, false
	}
	return host, port, true
}

func parseListeningProcess(value string) (int64, string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, ""
	}
	if match := listenerSSProcessPattern.FindStringSubmatch(value); len(match) == 3 {
		if pid, err := strconv.ParseInt(match[2], 10, 64); err == nil {
			return pid, strings.TrimSpace(match[1])
		}
	}
	if match := listenerNetstatProcessPattern.FindStringSubmatch(value); len(match) == 3 {
		if pid, err := strconv.ParseInt(match[1], 10, 64); err == nil {
			return pid, strings.TrimSpace(match[2])
		}
	}
	return 0, ""
}
