package main

import (
	"fmt"
	"os"
)

func greeting(name string) string {
	return fmt.Sprintf("Hello, %s!", name)
}

func main() {
	name := "world"
	if len(os.Args) > 1 {
		name = os.Args[1]
	}
	fmt.Println(greeting(name))
}
