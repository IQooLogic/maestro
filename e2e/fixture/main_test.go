package main

import "testing"

func TestGreeting(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want string
	}{
		{name: "world", in: "world", want: "Hello, world!"},
		{name: "name", in: "Ana", want: "Hello, Ana!"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := greeting(tt.in); got != tt.want {
				t.Errorf("greeting(%q) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}
