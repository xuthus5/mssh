package service

import (
	"strings"

	"github.com/xuthus5/mssh/internal/model"
)

const (
	networkRoleLoopback = "loopback"
	networkRolePhysical = "physical"
	networkRoleBond     = "bond"
	networkRoleBridge   = "bridge"
	networkRoleTeam     = "team"
	networkRoleSlave    = "slave"
)

func parseSystemNetworkInterfaceField(result *model.SystemInfo, sample *systemSample, values []string, uint func(string) uint64, valid *bool) int {
	if len(values) < 4 {
		return -1
	}
	networkInterface := model.NetworkInterface{
		Name: trimField(values[1]), ReceivedBytes: uint(values[2]), TransmittedBytes: uint(values[3]),
	}
	if networkInterface.Name == "" {
		*valid = false
		return 4
	}
	networkInterface.Virtual = isVirtualNetworkInterface(networkInterface.Name)
	networkInterface.Role = sample.roles[networkInterface.Name]
	if networkInterface.Role == networkRoleLoopback {
		networkInterface.Virtual = true
	}
	result.Interfaces = append(result.Interfaces, networkInterface)
	sample.interfaces[networkInterface.Name] = networkCounter{
		received: networkInterface.ReceivedBytes, transmitted: networkInterface.TransmittedBytes,
	}
	sample.received += networkInterface.ReceivedBytes
	sample.transmitted += networkInterface.TransmittedBytes
	sample.hasNetwork = true
	sample.hasInterfaces = true
	return 4
}

func parseSystemNetworkRoleField(result *model.SystemInfo, sample *systemSample, values []string, valid *bool) int {
	if len(values) < 3 {
		return -1
	}
	name, role := trimField(values[1]), trimField(values[2])
	if name == "" || !validNetworkRole(role) {
		*valid = false
		return 3
	}
	if sample.roles == nil {
		sample.roles = make(map[string]string)
	}
	sample.roles[name] = role
	for index := range result.Interfaces {
		if result.Interfaces[index].Name == name {
			result.Interfaces[index].Role = role
			if role == networkRoleLoopback {
				result.Interfaces[index].Virtual = true
			}
		}
	}
	return 3
}

func validNetworkRole(role string) bool {
	switch role {
	case networkRoleLoopback, networkRolePhysical, networkRoleBond, networkRoleBridge, networkRoleTeam, networkRoleSlave:
		return true
	default:
		return false
	}
}

func isVirtualNetworkInterface(name string) bool {
	if name == "lo" || strings.HasPrefix(name, "lo0") {
		return true
	}
	virtualPrefixes := []string{
		"veth", "docker", "br-", "virbr", "cni", "flannel", "cali", "vxlan", "vnet",
		"utun", "awdl", "llw", "bridge", "anpi", "gif", "stf", "tunl", "tun", "tap", "wg",
	}
	for _, prefix := range virtualPrefixes {
		if strings.HasPrefix(name, prefix) {
			return true
		}
	}
	return false
}
