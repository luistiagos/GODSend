; Portable launcher: the xboxcompanion.exe the customer downloads.
;
; electron-builder compiles the portable .exe from its own template
; (app-builder-lib/templates/nsis/portable.nsi) and has no option to replace it;
; scripts/portable-launcher-hook.js hands makensis this file instead. It keeps
; the template's contract (unpack the app under %TEMP%, export
; PORTABLE_EXECUTABLE_*, wait for the app, clean up) and changes what made a
; failed launch invisible:
;
;  * the template runs silent and its only error box has a silent default, so
;    nothing is ever shown, not even while it works;
;  * it writes the .7z, unpacks it to 7z-out and then copies that to app: 3 GB
;    of %TEMP% for a 1.3 GB app, kept for as long as the app is open;
;  * Nsis7z reports nothing when extraction fails, and the template starts
;    whatever was left behind.
;
; Here the free space is checked before anything is written, the app is
; unpacked once and straight into place, the result is verified, and every
; failure tells the customer why and leaves a line the app reports at its next
; start (services/portableLauncherReport.ts).

!include "common.nsh"
!include "FileFunc.nsh"

!ifdef APP_DIR_64 | APP_DIR_32 | APP_DIR_ARM64
  !error "build/portable.nsi does not support portable.useZip: there is no .7z package to unpack"
!endif
!ifdef SPLASH_IMAGE
  !error "build/portable.nsi does not support portable.splashImage: the launcher has its own progress window"
!endif
!ifdef UNPACK_DIR_NAME
  !error "build/portable.nsi needs portable.unpackDirName = true: the app is unpacked inside the launcher's own temp folder"
!endif

; https://github.com/electron-userland/electron-builder/issues/3972#issuecomment-505171582
CRCCheck off
WindowIcon Off
AutoCloseWindow True
RequestExecutionLevel ${REQUEST_EXECUTION_LEVEL}

; NSIS' own texts (buttons, its error boxes) in Portuguese on a pt-BR Windows.
LoadLanguageFile "${NSISDIR}\Contrib\Language files\PortugueseBR.nlf"
Caption "${PRODUCT_NAME}"
SubCaption 3 " "
SubCaption 4 " "

; Room left on the disk once the app is unpacked.
!define LAUNCHER_HEADROOM_MB 100
; Top-level windows of an Electron (Chromium) app. If this ever changes, the
; launcher window just stays for the whole wait below instead of leaving early.
!define APP_WINDOW_CLASS "Chrome_WidgetWin_1"
; How long the launcher window waits for the app's own: 300 x 200 ms.
!define APP_WINDOW_WAIT_POLLS 300
; Read and reported by the app at its next start.
!define LAUNCHER_FAILURE_LOG_DIR "$EXEDIR\godsend-data"
!define LAUNCHER_FAILURE_LOG "${LAUNCHER_FAILURE_LOG_DIR}\launcher-failures.log"

!define MSG_PREPARE_FAILED "Não foi possível preparar os arquivos do ${PRODUCT_NAME}.$\r$\n$\r$\nCausas possíveis:$\r$\n- o arquivo baixado está incompleto ou danificado: baixe de novo;$\r$\n- o disco ficou sem espaço durante a preparação: libere espaço;$\r$\n- o antivírus bloqueou ou apagou arquivos do programa: libere o ${PRODUCT_NAME} no antivírus.$\r$\n$\r$\nDepois, abra o programa de novo."
!define MSG_START_FAILED "Os arquivos do ${PRODUCT_NAME} foram preparados, mas o Windows não conseguiu iniciar o programa.$\r$\n$\r$\nCausas possíveis: o antivírus bloqueou ou apagou o programa, ou o arquivo baixado está danificado.$\r$\n$\r$\nLibere o ${PRODUCT_NAME} no antivírus e abra de novo. Se continuar, baixe o arquivo novamente."

Var packageArch ; "32" | "64" | "ARM64"
Var packageKb   ; size of the .7z for this architecture
Var unpackedKb  ; size of the app once unpacked
Var requiredMb
Var freeMb

!macro status TEXT
  SetDetailsPrint textonly
  DetailPrint "${TEXT}"
  SetDetailsPrint none
!macroend

; One section per architecture so SectionGetSize gives the size of the one
; package that will really be written; .onInit switches the others off.
!macro packageSection ARCH FILE
  Section "-package ${ARCH}" SecPackage${ARCH}
    !insertmacro status "Abrindo o ${PRODUCT_NAME}..."
    !ifdef COMPRESS
      SetCompress off
    !endif
    File /oname=$PLUGINSDIR\app.7z "${FILE}"
    !ifdef COMPRESS
      SetCompress "${COMPRESS}"
    !endif
  SectionEnd
!macroend

!macro selectPackage ARCH
  ${if} $packageArch == "${ARCH}"
    SectionGetSize ${SecPackage${ARCH}} $packageKb
    StrCpy $unpackedKb "${APP_${ARCH}_UNPACKED_SIZE}"
  ${else}
    SectionSetFlags ${SecPackage${ARCH}} 0
  ${endIf}
!macroend

!ifdef APP_32
  !insertmacro packageSection 32 "${APP_32}"
!endif
!ifdef APP_64
  !insertmacro packageSection 64 "${APP_64}"
!endif
!ifdef APP_ARM64
  !insertmacro packageSection ARM64 "${APP_ARM64}"
!endif

Section "-launch"
  StrCpy $INSTDIR "$PLUGINSDIR\app"
  SetOutPath $INSTDIR

  ; Straight into place. The template unpacks to 7z-out and copies from there,
  ; which only pays off when replacing an installed app that may be running.
  Nsis7z::ExtractWithDetails "$PLUGINSDIR\app.7z" "Abrindo o ${PRODUCT_NAME}: %s"
  Delete "$PLUGINSDIR\app.7z"

  ; Nsis7z sets no error flag and returns nothing: a damaged or cut-short
  ; package leaves a partial tree behind and looks like success.
  LockWindow on ; GetSize prints its running tally on the status line
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  !insertmacro status "Abrindo o ${PRODUCT_NAME}..."
  LockWindow off
  IntOp $1 $0 + 1 ; the build rounds the expected size up, GetSize rounds down
  ${if} $1 < $unpackedKb
  ${orIfNot} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    StrCpy $R1 "extracao-incompleta extraido_kb=$0 esperado_kb=$unpackedKb"
    StrCpy $R2 "${MSG_PREPARE_FAILED}"
    Call launcherFailed
  ${endIf}

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0

  ; Started by hand instead of ExecWait, which hands back neither handle nor
  ; pid: this window stays up until the app shows its own, so the customer is
  ; not left looking at nothing while Windows loads a 230 MB .exe.
  !insertmacro status "Iniciando o ${PRODUCT_NAME}..."
  System::Alloc 68 ; STARTUPINFO of the 32-bit launcher, zeroed
  Pop $1
  System::Call '*$1(i 68)' ; cb
  System::Alloc 16 ; PROCESS_INFORMATION
  Pop $2
  System::Call 'kernel32::CreateProcess(p 0, t "$INSTDIR\${APP_EXECUTABLE_FILENAME} $R0", p 0, p 0, i 0, i 0, p 0, p 0, p r1, p r2) i .r0 ?e'
  Pop $6 ; GetLastError
  System::Call '*$2(p .r3, p .r4, i .r5)' ; hProcess, hThread, pid
  System::Free $1
  System::Free $2
  ${if} $0 == 0
    StrCpy $R1 "nao-iniciou erro=$6"
    StrCpy $R2 "${MSG_START_FAILED}"
    Call launcherFailed
  ${endIf}
  System::Call 'kernel32::CloseHandle(p r4)'

  StrCpy $6 ${APP_WINDOW_WAIT_POLLS}
  ${doWhile} $6 > 0
    IntOp $6 $6 - 1
    System::Call 'kernel32::WaitForSingleObject(p r3, i 200) i .r0'
    ${if} $0 != 258 ; anything but WAIT_TIMEOUT: the app is gone already
      ${exitDo}
    ${endIf}
    StrCpy $7 0
    ${do}
      FindWindow $7 "${APP_WINDOW_CLASS}" "" 0 $7
      ${if} $7 == 0
        ${exitDo}
      ${endIf}
      System::Call 'user32::GetWindowThreadProcessId(p r7, *i .r8)'
      System::Call 'user32::IsWindowVisible(p r7) i .r9'
      ${if} $8 == $5
      ${andIf} $9 != 0
        StrCpy $6 0
        ${exitDo}
      ${endIf}
    ${loop}
  ${loop}
  HideWindow
  System::Call 'kernel32::WaitForSingleObject(p r3, i -1)'
  System::Call 'kernel32::GetExitCodeProcess(p r3, *i .r0)'
  System::Call 'kernel32::CloseHandle(p r3)'
  SetErrorLevel $0

  SetOutPath $EXEDIR
  RMDir /r $INSTDIR
SectionEnd

; $R0: MB in, text out ("782 MB", "1,9 GB"). $R1: 0 rounds down, 1023 rounds up.
Function formatMb
  ${if} $R0 < 1024
    StrCpy $R0 "$R0 MB"
  ${else}
    IntOp $R0 $R0 * 10
    IntOp $R0 $R0 + $R1
    IntOp $R0 $R0 / 1024
    IntOp $R1 $R0 % 10
    IntOp $R0 $R0 / 10
    StrCpy $R0 "$R0,$R1 GB"
  ${endIf}
FunctionEnd

; $R1: reason for the failure log (ASCII), $R2: text for the customer.
Function launcherFailed
  SetDetailsPrint none
  ClearErrors
  CreateDirectory "${LAUNCHER_FAILURE_LOG_DIR}"
  FileOpen $R9 "${LAUNCHER_FAILURE_LOG}" a
  ${ifNot} ${Errors}
    FileSeek $R9 0 END
    ${GetTime} "" "L" $0 $1 $2 $3 $4 $5 $6
    FileWrite $R9 "$2-$1-$0 $4:$5:$6$\t${VERSION}$\t$R1$\r$\n"
    FileClose $R9
  ${endIf}

  ; /SD: `xboxcompanion.exe /S` stays silent, and then only the log tells why.
  MessageBox MB_OK|MB_ICONEXCLAMATION "$R2" /SD IDOK
  SetOutPath $EXEDIR ; nothing may hold the temp folder NSIS removes on exit
  SetErrorLevel 2
  Quit
FunctionEnd

Function checkFreeSpace
  IntOp $requiredMb $packageKb + $unpackedKb
  IntOp $requiredMb $requiredMb / 1024
  IntOp $requiredMb $requiredMb + ${LAUNCHER_HEADROOM_MB}
  ; Lets a test (or support) see the "no space" path on a disk that has room.
  ReadEnvStr $0 "XBOX360COMPANION_LAUNCHER_EXTRA_MB"
  ${if} $0 > 0
    IntOp $requiredMb $requiredMb + $0
  ${endIf}

  System::Call 'kernel32::GetDiskFreeSpaceEx(t "$TEMP", *l .r1, *l .r2, *l .r3) i .r0'
  ${if} $0 == 0
    Return ; could not measure: go on, the check after unpacking still stands
  ${endIf}
  System::Int64Op $1 / 1048576
  Pop $freeMb
  ${if} $freeMb >= $requiredMb
    Return
  ${endIf}

  ${GetRoot} "$TEMP" $R8
  ${if} $R8 == ""
    StrCpy $R4 "na pasta temporária do Windows"
  ${else}
    StrCpy $R4 "no disco $R8"
  ${endIf}
  StrCpy $R0 $freeMb
  StrCpy $R1 0
  Call formatMb
  StrCpy $R5 $R0
  StrCpy $R0 $requiredMb
  StrCpy $R1 1023
  Call formatMb
  StrCpy $R6 $R0
  IntOp $R0 $requiredMb - $freeMb
  StrCpy $R1 1023
  Call formatMb
  StrCpy $R7 $R0

  StrCpy $R1 "sem-espaco disco=$R8 livre_mb=$freeMb necessario_mb=$requiredMb"
  StrCpy $R2 "Não há espaço livre suficiente $R4 para abrir o ${PRODUCT_NAME}.$\r$\n$\r$\nLivre agora: $R5$\r$\nNecessário: $R6$\r$\n$\r$\nLibere pelo menos $R7 $R4 e abra o programa de novo. Para liberar espaço, esvazie a Lixeira, apague arquivos que não usa mais ou abra a Limpeza de Disco do Windows.$\r$\n$\r$\nO programa usa esse espaço na pasta temporária do Windows a cada abertura, mesmo quando o arquivo baixado está em outro disco."
  Call launcherFailed
FunctionEnd

Function .onInit
  !insertmacro check64BitAndSetRegView

  ; Which package suits this Windows: same rule as the template's identify_package.
  !ifdef APP_32
    StrCpy $packageArch "32"
  !endif
  !ifdef APP_64
    ${if} ${RunningX64}
    ${orIf} ${IsNativeARM64}
      StrCpy $packageArch "64"
    ${endIf}
  !endif
  !ifdef APP_ARM64
    ${if} ${IsNativeARM64}
      StrCpy $packageArch "ARM64"
    ${endIf}
  !endif

  !ifdef APP_32
    !insertmacro selectPackage 32
  !endif
  !ifdef APP_64
    !insertmacro selectPackage 64
  !endif
  !ifdef APP_ARM64
    !insertmacro selectPackage ARM64
  !endif

  Call checkFreeSpace
FunctionEnd

; NSIS itself gave up: it could not write the package to %TEMP% (the disk
; filled up after the check, or something blocked the write). In the window
; this comes after NSIS' own error box.
Function .onInstFailed
  StrCpy $R1 "pacote-nao-gravado"
  StrCpy $R2 "${MSG_PREPARE_FAILED}"
  Call launcherFailed
FunctionEnd
