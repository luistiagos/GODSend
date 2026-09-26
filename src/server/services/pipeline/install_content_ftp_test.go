// install_content_ftp_test.go — the install set is checked on the console over FTP too. The fake
// server behaves the way services/content documents Aurora: a LIST ignores its path argument
// and lists the current folder, and a RETR only takes a name in the current folder. Only what
// the console positively shows may fail the job; a console that stops answering may not.
package pipeline

import (
	"bufio"
	"fmt"
	"net"
	"path"
	"strings"
	"testing"
	"time"

	"godsend/models"

	goftp "github.com/jlaffaye/ftp"
)

type fakeConsoleFTP struct {
	files     map[string][]byte // absolute path -> content
	listReply string            // when set, LIST fails with this reply
	stallRetr bool              // RETR opens the transfer and never sends anything
	release   chan struct{}     // closed at cleanup to free stalled transfers
}

func startFakeConsoleFTP(t *testing.T, console *fakeConsoleFTP) string {
	t.Helper()
	console.release = make(chan struct{})
	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		close(console.release)
		ln.Close()
	})
	go func() {
		for {
			conn, err := ln.Accept()
			if err != nil {
				return
			}
			go console.serve(conn)
		}
	}()
	return ln.Addr().String()
}

func (f *fakeConsoleFTP) hasFolder(dir string) bool {
	for p := range f.files {
		if strings.HasPrefix(p, strings.TrimSuffix(dir, "/")+"/") {
			return true
		}
	}
	return false
}

func (f *fakeConsoleFTP) serve(conn net.Conn) {
	defer conn.Close()
	reply := func(line string) { fmt.Fprintf(conn, "%s\r\n", line) }
	reader := bufio.NewReader(conn)
	cwd := "/"
	var passive net.Listener
	reply("220 console")
	for {
		line, err := reader.ReadString('\n')
		if err != nil {
			return
		}
		cmd, arg, _ := strings.Cut(strings.TrimRight(line, "\r\n"), " ")
		switch cmd = strings.ToUpper(cmd); cmd {
		case "USER":
			reply("331 password")
		case "PASS":
			reply("230 logged in")
		case "TYPE":
			reply("200 ok")
		case "CWD":
			if !f.hasFolder(arg) {
				reply("550 No such directory")
				continue
			}
			cwd = arg
			reply("250 ok")
		case "PASV":
			if passive, err = net.Listen("tcp", "127.0.0.1:0"); err != nil {
				reply("425 no passive port")
				continue
			}
			port := passive.Addr().(*net.TCPAddr).Port
			reply(fmt.Sprintf("227 Entering Passive Mode (127,0,0,1,%d,%d)", port/256, port%256))
		case "LIST", "RETR":
			data, err := passive.Accept()
			passive.Close()
			if err != nil {
				reply("425 no data connection")
				continue
			}
			if cmd == "LIST" && f.listReply != "" {
				data.Close()
				reply(f.listReply)
				continue
			}
			var body []byte
			if cmd == "LIST" {
				body = f.listing(cwd) // the path argument is ignored, as on Aurora
			} else if content, ok := f.files[path.Join(cwd, arg)]; ok && !strings.HasPrefix(arg, "/") {
				body = content
			} else {
				data.Close()
				reply("550 No such file")
				continue
			}
			reply("150 opening data connection")
			if cmd == "RETR" && f.stallRetr {
				<-f.release
				data.Close()
				return
			}
			_, _ = data.Write(body) // a client that stops early just discards the rest
			data.Close()
			reply("226 transfer complete")
		case "QUIT":
			reply("221 bye")
			return
		default:
			reply("502 not implemented")
		}
	}
}

func (f *fakeConsoleFTP) listing(dir string) []byte {
	prefix := strings.TrimSuffix(dir, "/") + "/"
	var lines []string
	for p, body := range f.files {
		if name := strings.TrimPrefix(p, prefix); name != p && !strings.Contains(name, "/") {
			lines = append(lines, fmt.Sprintf("-rw-r--r-- 1 xbox xbox %d Jan 01 00:00 %s", len(body), name))
		}
	}
	return []byte(strings.Join(lines, "\r\n") + "\r\n")
}

const consoleInstallDir = "/Hdd1/Content/0000000000000000/545408A7/00000002"

func gtaVInstallFiles(t *testing.T, names ...string) map[string][]byte {
	t.Helper()
	if len(names) == 0 {
		names = gtaVPackages
	}
	files := map[string][]byte{}
	for _, name := range names {
		files[consoleInstallDir+"/"+name] = installPackageBytes(t, "545408A7", 0x2000)
	}
	return files
}

func dialFakeConsole(t *testing.T, console *fakeConsoleFTP) *goftp.ServerConn {
	t.Helper()
	fc, err := goftp.Dial(startFakeConsoleFTP(t, console), goftp.DialWithTimeout(5*time.Second),
		goftp.DialWithDisabledEPSV(true), goftp.DialWithDisabledUTF8(true))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { fc.Quit() })
	if err := fc.Login("xboxftp", "xboxftp"); err != nil {
		t.Fatal(err)
	}
	return fc
}

func TestFTPInstallSetCheckReportsOnlyWhatTheConsoleShows(t *testing.T) {
	spec, _ := models.RequiresMandatoryInstallDisc(gtaVTitleID)
	truncatedFirst := func(t *testing.T) map[string][]byte {
		// The first package is read before the other three: if closing its transfer early
		// left a reply unread, every later header would come back empty.
		files := gtaVInstallFiles(t)
		first := consoleInstallDir + "/" + gtaVPackages[0]
		files[first] = files[first][:len(files[first])-1]
		return files
	}

	for _, tc := range []struct {
		name        string
		console     func(t *testing.T) *fakeConsoleFTP
		wantProblem string
		wantChecked bool
	}{
		{"conjunto completo", func(t *testing.T) *fakeConsoleFTP {
			return &fakeConsoleFTP{files: gtaVInstallFiles(t)}
		}, "", true},
		{"pasta ausente", func(t *testing.T) *fakeConsoleFTP {
			return &fakeConsoleFTP{files: map[string][]byte{"/Hdd1/Games/other/default.xex": nil}}
		}, "faltam 545408A700000000, 545408A700000001, 545408A700000002, 545408A700000003", true},
		{"conjunto parcial", func(t *testing.T) *fakeConsoleFTP {
			return &fakeConsoleFTP{files: gtaVInstallFiles(t, gtaVPackages[:3]...)}
		}, "faltam 545408A700000003", true},
		{"primeiro pacote truncado", func(t *testing.T) *fakeConsoleFTP {
			return &fakeConsoleFTP{files: truncatedFirst(t)}
		}, "545408A700000000 truncado (53247 de 53248 bytes)", true},
		{"LIST sem canal de dados", func(t *testing.T) *fakeConsoleFTP {
			return &fakeConsoleFTP{files: gtaVInstallFiles(t), listReply: "425 Can't open data connection"}
		}, "", false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fc := dialFakeConsole(t, tc.console(t))

			problem, checked := ftpInstallSetProblemWithin(fc, consoleInstallDir, spec, 10*time.Second)

			if problem != tc.wantProblem || checked != tc.wantChecked {
				t.Errorf("obtido (%q, %v), esperado (%q, %v)", problem, checked, tc.wantProblem, tc.wantChecked)
			}
		})
	}
}

// TestFTPInstallSetCheckGivesUpOnAStalledConsole: the check runs while the job holds the
// processing lane and the console's FTP slot, so a transfer that never ends must not hold them.
func TestFTPInstallSetCheckGivesUpOnAStalledConsole(t *testing.T) {
	spec, _ := models.RequiresMandatoryInstallDisc(gtaVTitleID)
	fc := dialFakeConsole(t, &fakeConsoleFTP{files: gtaVInstallFiles(t), stallRetr: true})

	start := time.Now()
	problem, checked := ftpInstallSetProblemWithin(fc, consoleInstallDir, spec, 500*time.Millisecond)

	if checked || problem != "" {
		t.Errorf("console travado tratado como conferido: (%q, %v)", problem, checked)
	}
	if elapsed := time.Since(start); elapsed > 3*time.Second {
		t.Errorf("a checagem esperou %s por um console travado", elapsed)
	}
}
