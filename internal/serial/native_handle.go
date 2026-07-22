package serial

import (
	"fmt"
	"reflect"
	"unsafe"
)

// extractNativeHandle returns the OS handle stored in go.bug.st/serial concrete ports.
// The library keeps handles private; reflection is required to re-apply termios/DCB
// flow-control flags after Open() forcibly disables them.
func extractNativeHandle(port any) (uintptr, error) {
	if port == nil {
		return 0, fmt.Errorf("serial port is nil")
	}
	value := reflect.ValueOf(port)
	if value.Kind() != reflect.Pointer || value.IsNil() {
		return 0, fmt.Errorf("serial port handle unavailable")
	}
	elem := value.Elem()
	if elem.Kind() != reflect.Struct {
		return 0, fmt.Errorf("serial port handle unavailable")
	}
	field := elem.FieldByName("handle")
	if !field.IsValid() {
		return 0, fmt.Errorf("serial port handle field missing")
	}
	if !field.CanAddr() {
		return 0, fmt.Errorf("serial port handle is not addressable")
	}
	// Bypass unexported-field visibility from the third-party package.
	readable := reflect.NewAt(field.Type(), unsafe.Pointer(field.UnsafeAddr())).Elem()
	switch readable.Kind() {
	case reflect.Int, reflect.Int8, reflect.Int16, reflect.Int32, reflect.Int64:
		return uintptr(readable.Int()), nil
	case reflect.Uint, reflect.Uint8, reflect.Uint16, reflect.Uint32, reflect.Uint64, reflect.Uintptr:
		return uintptr(readable.Uint()), nil
	default:
		return 0, fmt.Errorf("unsupported serial handle kind %s", readable.Kind())
	}
}
