package service

import (
	"context"
	"fmt"
	"net"
	"net/http"
	"sync"
	"sync/atomic"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/store"
)

const (
	aiAgentMCPTokenAccount = "agent-mcp"
	aiAgentMCPQueueLimit   = 32
	aiAgentMCPTaskPrompt   = "MSSH 外部 MCP 会话"
	aiAgentMCPServerName   = "mssh-agent"
)

// aiAgentMCPRuntime guards the single user-started external MCP endpoint.
type aiAgentMCPRuntime struct {
	mu     sync.Mutex
	server *aiAgentMCPServer
}

// aiAgentMCPServer serves the loopback MCP endpoint that external CLI tools
// connect to. It binds to one session and reuses a single task until the client
// calls task.finish or the endpoint stops.
type aiAgentMCPServer struct {
	service   *AIService
	sessionID int64
	token     string
	security  model.AISecuritySettings

	ctx      context.Context
	cancel   context.CancelFunc
	listener net.Listener
	http     *http.Server

	gate    chan struct{}
	pending atomic.Int64

	mu         sync.Mutex
	bridge     *aiAgentMCPBridge
	connection *aiAgentSSH
	taskCancel context.CancelFunc
}

func (s *AIService) GetAgentMCPServerStatus() (model.AIMCPServerStatus, error) {
	_, finish, err := s.beginOperation()
	if err != nil {
		return model.AIMCPServerStatus{}, err
	}
	defer finish()
	return s.agentMCPServerStatus()
}

// StartAgentMCPServer persists the requested binding and (re)starts the endpoint.
func (s *AIService) StartAgentMCPServer(input model.AIMCPServerInput) (model.AIMCPServerStatus, error) {
	_, finish, err := s.beginOperation()
	if err != nil {
		return model.AIMCPServerStatus{}, err
	}
	defer finish()
	if input.SessionID <= 0 {
		return model.AIMCPServerStatus{}, fmt.Errorf("MCP server session is required")
	}
	if _, err := store.GetSession(s.db, input.SessionID); err != nil {
		return model.AIMCPServerStatus{}, err
	}
	settings, err := store.LoadAISettings(s.db, defaultAISettings())
	if err != nil {
		return model.AIMCPServerStatus{}, err
	}
	settings.Interaction.MCP = model.AIMCPServerSettings(input)
	if err := validateAISettings(settings); err != nil {
		return model.AIMCPServerStatus{}, err
	}
	if err := store.SaveAISettings(s.db, settings); err != nil {
		return model.AIMCPServerStatus{}, err
	}
	token, err := s.ensureAgentMCPToken()
	if err != nil {
		return model.AIMCPServerStatus{}, err
	}
	if err := s.stopAgentMCPServer(); err != nil {
		return model.AIMCPServerStatus{}, err
	}
	server, err := newAIAgentMCPServer(s, input.SessionID, input.Port, token, settings.Security)
	if err != nil {
		return model.AIMCPServerStatus{}, err
	}
	s.mcp.mu.Lock()
	s.mcp.server = server
	s.mcp.mu.Unlock()
	return s.agentMCPServerStatus()
}

func (s *AIService) StopAgentMCPServer() error {
	_, finish, err := s.beginOperation()
	if err != nil {
		return err
	}
	defer finish()
	return s.stopAgentMCPServer()
}

// RegenerateAgentMCPToken rotates the bearer token and restarts a running
// endpoint so the previous token is rejected immediately.
func (s *AIService) RegenerateAgentMCPToken() (model.AIMCPServerStatus, error) {
	_, finish, err := s.beginOperation()
	if err != nil {
		return model.AIMCPServerStatus{}, err
	}
	defer finish()
	token, err := randomAIAgentToken()
	if err != nil {
		return model.AIMCPServerStatus{}, err
	}
	s.secrets.set(aiAgentMCPTokenAccount, token)
	settings, err := store.LoadAISettings(s.db, defaultAISettings())
	if err != nil {
		return model.AIMCPServerStatus{}, err
	}
	previous := s.detachAgentMCPServer()
	if previous != nil {
		if err := previous.stop(); err != nil {
			return model.AIMCPServerStatus{}, err
		}
		restarted, startErr := newAIAgentMCPServer(s, settings.Interaction.MCP.SessionID, settings.Interaction.MCP.Port, token, settings.Security)
		if startErr != nil {
			return model.AIMCPServerStatus{}, startErr
		}
		s.mcp.mu.Lock()
		s.mcp.server = restarted
		s.mcp.mu.Unlock()
	}
	return s.agentMCPServerStatus()
}

func (s *AIService) agentMCPServerStatus() (model.AIMCPServerStatus, error) {
	settings, err := store.LoadAISettings(s.db, defaultAISettings())
	if err != nil {
		return model.AIMCPServerStatus{}, err
	}
	status := model.AIMCPServerStatus{SessionID: settings.Interaction.MCP.SessionID, Port: settings.Interaction.MCP.Port}
	s.mcp.mu.Lock()
	server := s.mcp.server
	s.mcp.mu.Unlock()
	if server != nil {
		status.Running = true
		status.URL = server.url()
		status.Port = server.port()
		status.SessionID = server.sessionID
		status.Token = server.token
	}
	if status.Token == "" {
		token, _, tokenErr := s.secrets.get(aiAgentMCPTokenAccount)
		if tokenErr != nil {
			return model.AIMCPServerStatus{}, tokenErr
		}
		status.Token = token
	}
	if status.SessionID > 0 {
		if session, sessionErr := store.GetSession(s.db, status.SessionID); sessionErr == nil && session != nil {
			status.SessionName = session.Name
		}
	}
	return status, nil
}

func (s *AIService) ensureAgentMCPToken() (string, error) {
	token, exists, err := s.secrets.get(aiAgentMCPTokenAccount)
	if err != nil {
		return "", err
	}
	if exists && token != "" {
		return token, nil
	}
	token, err = randomAIAgentToken()
	if err != nil {
		return "", err
	}
	s.secrets.set(aiAgentMCPTokenAccount, token)
	return token, nil
}

func (s *AIService) detachAgentMCPServer() *aiAgentMCPServer {
	s.mcp.mu.Lock()
	defer s.mcp.mu.Unlock()
	server := s.mcp.server
	s.mcp.server = nil
	return server
}

func (s *AIService) stopAgentMCPServer() error {
	if s == nil {
		return nil
	}
	server := s.detachAgentMCPServer()
	if server == nil {
		return nil
	}
	return server.stop()
}
