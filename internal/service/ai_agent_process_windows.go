//go:build windows

package service

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"sync"
	"unsafe"

	"golang.org/x/sys/windows"
)

type windowsAIAgentProcessLifecycle struct {
	mu       sync.Mutex
	job      windows.Handle
	assigned bool
	canceled bool
	closed   bool
}

func newAIAgentProcessLifecycle(command *exec.Cmd) (aiAgentProcessLifecycle, error) {
	job, err := newAIAgentJobObject()
	if err != nil {
		return nil, err
	}
	command.SysProcAttr = &windows.SysProcAttr{CreationFlags: windows.CREATE_SUSPENDED}
	return &windowsAIAgentProcessLifecycle{job: job}, nil
}

func newAIAgentJobObject() (windows.Handle, error) {
	job, err := windows.CreateJobObject(nil, nil)
	if err != nil {
		return 0, fmt.Errorf("create Windows job object: %w", err)
	}
	info := windows.JOBOBJECT_EXTENDED_LIMIT_INFORMATION{}
	info.BasicLimitInformation.LimitFlags = windows.JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
	_, err = windows.SetInformationJobObject(
		job,
		windows.JobObjectExtendedLimitInformation,
		uintptr(unsafe.Pointer(&info)),
		uint32(unsafe.Sizeof(info)),
	)
	if err != nil {
		return 0, errors.Join(fmt.Errorf("configure Windows job object: %w", err), windows.CloseHandle(job))
	}
	return job, nil
}

func (lifecycle *windowsAIAgentProcessLifecycle) Started(command *exec.Cmd) (resultErr error) {
	if command.Process == nil {
		return os.ErrProcessDone
	}
	process, err := windows.OpenProcess(
		windows.PROCESS_SET_QUOTA|windows.PROCESS_TERMINATE,
		false,
		uint32(command.Process.Pid),
	)
	if err != nil {
		return fmt.Errorf("open suspended AI agent CLI process: %w", err)
	}
	defer func() { resultErr = errors.Join(resultErr, windows.CloseHandle(process)) }()
	return lifecycle.assignAndResume(process, uint32(command.Process.Pid))
}

func (lifecycle *windowsAIAgentProcessLifecycle) assignAndResume(process windows.Handle, pid uint32) error {
	lifecycle.mu.Lock()
	defer lifecycle.mu.Unlock()
	if lifecycle.closed {
		return os.ErrProcessDone
	}
	if err := windows.AssignProcessToJobObject(lifecycle.job, process); err != nil {
		return fmt.Errorf("assign AI agent CLI to Windows job object: %w", err)
	}
	lifecycle.assigned = true
	if lifecycle.canceled {
		return lifecycle.terminateLocked()
	}
	if err := resumeAIAgentProcess(pid); err != nil {
		return errors.Join(err, lifecycle.terminateLocked())
	}
	return nil
}

func resumeAIAgentProcess(pid uint32) (resultErr error) {
	snapshot, err := windows.CreateToolhelp32Snapshot(windows.TH32CS_SNAPTHREAD, 0)
	if err != nil {
		return fmt.Errorf("snapshot Windows threads: %w", err)
	}
	defer func() { resultErr = errors.Join(resultErr, windows.CloseHandle(snapshot)) }()
	threadID, err := findAIAgentProcessThread(snapshot, pid)
	if err != nil {
		return err
	}
	thread, err := windows.OpenThread(windows.THREAD_SUSPEND_RESUME, false, threadID)
	if err != nil {
		return fmt.Errorf("open suspended AI agent CLI thread: %w", err)
	}
	defer func() { resultErr = errors.Join(resultErr, windows.CloseHandle(thread)) }()
	if _, err = windows.ResumeThread(thread); err != nil {
		return fmt.Errorf("resume AI agent CLI process: %w", err)
	}
	return nil
}

func findAIAgentProcessThread(snapshot windows.Handle, pid uint32) (uint32, error) {
	entry := windows.ThreadEntry32{Size: uint32(unsafe.Sizeof(windows.ThreadEntry32{}))}
	if err := windows.Thread32First(snapshot, &entry); err != nil {
		return 0, fmt.Errorf("read Windows thread snapshot: %w", err)
	}
	for {
		if entry.OwnerProcessID == pid {
			return entry.ThreadID, nil
		}
		if err := windows.Thread32Next(snapshot, &entry); err != nil {
			return 0, fmt.Errorf("find suspended AI agent CLI thread: %w", err)
		}
	}
}

func (lifecycle *windowsAIAgentProcessLifecycle) Cancel(command *exec.Cmd) error {
	if command.Process == nil {
		return os.ErrProcessDone
	}
	lifecycle.mu.Lock()
	defer lifecycle.mu.Unlock()
	if lifecycle.closed || lifecycle.job == 0 {
		return os.ErrProcessDone
	}
	lifecycle.canceled = true
	if !lifecycle.assigned {
		return nil
	}
	return lifecycle.terminateLocked()
}

func (lifecycle *windowsAIAgentProcessLifecycle) terminateLocked() error {
	if err := windows.TerminateJobObject(lifecycle.job, 1); err != nil {
		return fmt.Errorf("terminate Windows AI agent CLI job: %w", err)
	}
	return nil
}

func (lifecycle *windowsAIAgentProcessLifecycle) Close() error {
	lifecycle.mu.Lock()
	if lifecycle.closed {
		lifecycle.mu.Unlock()
		return nil
	}
	lifecycle.closed = true
	job := lifecycle.job
	lifecycle.job = 0
	lifecycle.mu.Unlock()
	if job == 0 {
		return nil
	}
	return windows.CloseHandle(job)
}
