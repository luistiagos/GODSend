# GODsend-360 Android App

Esta pasta contém o aplicativo nativo Android para o **GODsend-360**.

## Arquitetura
1. **Backend Go (`libgodsend.so`)**: Compilado nativamente para `android/arm64` a partir de `src/server/` e empacotado em `jniLibs/arm64-v8a/libgodsend.so`.
2. **Foreground Service (`GodsendBackendService.kt`)**: Mantém o servidor Go rodando em segundo plano no dispositivo com notificação persistente e `WakeLock`, garantindo downloads e conversões ISO→GOD ininterruptas mesmo com a tela desligada.
3. **Activity Nativa (`MainActivity.kt`)**: Carrega a interface web local (`http://127.0.0.1:8080`) e gerencia as permissões de armazenamento do Android.

---

## Solução SELinux (Android 10+)
No Android 10+ (API 29+), o SELinux proíbe a execução de binários dinâmicos em `context.filesDir` (`Permission denied (error=13)`). 
Para contornar esse bloqueio em dispositivos não-roteados, o aplicativo empacota o servidor Go como uma biblioteca nativa JNI (`libgodsend.so`) com `android:extractNativeLibs="true"`, permitindo a execução a partir do `applicationInfo.nativeLibraryDir`.

---

## Assistente Passo a Passo (Wizard Mobile)
A interface móvel conta com um assistente didático de 3 passos:
1. **Passo 1 (Modo)**: Seleção entre `Enviar pelo Wi-Fi` vs `Gravar em Pendrive / Cartão SD`.
2. **Passo 2 (Configuração)**:
   - **Modo Wi-Fi**: Exibe checklist de requisitos (RGH/JTAG, Aurora/FSD), executa descoberta automática de IP (`/ftp/discover`), teste de ping (`POST /ftp/ping`), seletor de unidade (`Hdd1:`, `Usb0:`) e formato (`GOD` / `XEX`).
   - **Modo Pendrive**: Escaneia unidades montadas (`/tools/storage-drives`) e verifica permissão de escrita em tempo real.
3. **Passo 3 (Pronto)**: Resumo da configuração e acesso rápido à lista de jogos (`/browse?platform=xbox360`).

---

## Como Compilar

### 1. Compilar o Backend Go para Android
No diretório raiz do repositório, execute:
```bash
npm run build:server:android
```
Isso gerará o binário `dist/godsend-android-arm64`.

### 2. Atualizar a Biblioteca Nativa Android
Copie o binário compilado para a pasta `jniLibs`:
```powershell
Copy-Item -Force "dist\godsend-android-arm64" "src\android-app\app\src\main\jniLibs\arm64-v8a\libgodsend.so"
```

### 3. Compilar e Instalar o APK com Gradle
No terminal:
```bash
cd src/android-app
./gradlew assembleDebug
```
O APK gerado estará em `src/android-app/app/build/outputs/apk/debug/app-debug.apk`.
Instale no dispositivo conectado via ADB:
```bash
adb install -r app/build/outputs/apk/debug/app-debug.apk
```
