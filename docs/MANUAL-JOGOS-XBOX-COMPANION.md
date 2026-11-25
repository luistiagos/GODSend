# Guia Definitivo do Xbox 360 Companion 🎮

> **Aplicação:** Xbox 360 Companion  
> **Sistemas Suportados:** Consoles RGH / JTAG e Consoles Bloqueados / LT (via Exploit BadAvatar)  
> **Dashboard Alvo:** Aurora Dashboard  
> **Idioma:** Português (Brasil)  

---

## 1. Visão Geral

O **Xbox 360 Companion** é uma solução completa para computador que simplifica o download de jogos de Xbox 360 (inclusive direto para qualquer pasta do computador, sem exigir pendrive), a preparação de pendrives ou HDs externos e o envio de jogos, DLCs e atualizações para o console.

### 💡 Principais Recursos
* **Download direto no computador (sem pendrive):** Pelo **Catálogo de Jogos**, você pode baixar os arquivos dos jogos já preparados diretamente em qualquer pasta do seu PC (Downloads, Documentos, HD externo, etc.).
* **Zero necessidade de conversões manuais:** O aplicativo baixa e prepara os jogos automaticamente nos formatos corretos aceitos pelo Xbox 360 (`GOD` ou `XEX`), eliminando a necessidade de converter imagens `.ISO` manualmente.
* **Formatação Integrada em FAT32:** O próprio aplicativo inclui formatador interno para preparar pendrives e HDs externos grandes no padrão **FAT32** exato exigido pelo console.
* **Automação via Rede (FTP):** Transfere arquivos diretamente do computador para o console RGH por Wi-Fi ou cabo de rede.

Na tela inicial do programa, você escolhe o que deseja fazer:
1. **Catálogo de Jogos (*Sem precisar de pendrive*):** Vai direto para a lista de jogos para baixar os arquivos **em qualquer pasta do seu computador** (ou em um pendrive já preparado).
2. **Preparar Pendrive / HD (*Passo a passo guiado*):** Prepara o seu pendrive ou HD externo com a dashboard **Aurora** (para RGH) ou o exploit **BadAvatar** (para consoles Bloqueados/LT), ou configura o envio via **Rede (FTP)** para consoles RGH.

---

## 2. Catálogo de Jogos: Baixando Direto em uma Pasta do PC (Sem Pendrive)

Use esta opção quando quiser apenas baixar os arquivos dos jogos de Xbox 360 para guardar no computador, em um HD externo ou organizar antes de passar para um pendrive.

### 🛠️ Passo a Passo:
1. Abra o **Xbox 360 Companion** no computador.
2. Na tela inicial, clique em **Catálogo de Jogos** (*Sem precisar de pendrive*).
3. Navegue pela lista ou use a barra de pesquisa no topo para localizar o jogo desejado.
4. Clique no jogo (se houver mais de uma região ou edição, escolha a versão desejada).
5. Na seção **Onde você quer salvar este jogo?**, escolha **Pasta no PC** (essa opção já vem marcada automaticamente quando não há pendrive conectado).
6. Clique em **Salvar em uma pasta…** (ou **Escolher pasta e baixar todos os N discos** em jogos multidisco).
7. A janela padrão do Windows abrirá: escolha ou crie a pasta onde deseja guardar os arquivos (por exemplo, dentro de *Downloads* ou *Documentos*) e confirme.
8. O download começará em segundo plano. Acompanhe na aba **Fila** lá em cima até aparecer **Pronto**.

---

## 3. Preparando o Pendrive ou HD Externo (USB)

Use este método para preparar a mídia que carregará a dashboard alternativa **Aurora** e armazenará seus jogos para rodar direto na TV.

### 📋 Requisitos para o USB
* Pendrive ou HD externo USB de no mínimo **8 GB** (recomendado 32 GB ou mais).
* O aplicativo **Xbox 360 Companion** aberto no computador.

### 🛠️ Passo a Passo da Preparação:
1. Abra o **Xbox 360 Companion** no computador.
2. Na tela inicial, clique em **Preparar Pendrive / HD** (*Passo a passo guiado*).
3. Selecione o tipo de desbloqueio do seu console:
   * **Xbox Desbloqueado RGH:** Se o seu console inicia na tela azul do XeLL ao ligar pelo botão Eject. O aplicativo gravará a Aurora e a inicialização automática (`launch.ini`).
   * **Xbox Bloqueado ou LT:** Se o console for travado ou rodar jogos piratas apenas em DVD. O aplicativo configurará o **BadAvatar** (exploit temporário para iniciar a Aurora com segurança na versão de sistema 17559).
4. Clique em **Avançar** e escolha **Gravar em um Pendrive ou HD** (*Bloqueado / LT / RGH*).
5. Conecte o pendrive/HD externo no computador e clique em **Atualizar**. Selecione a unidade correspondente.
6. **Formatação Automática (Recomendado):** Marque a opção **Formatar antes** para apagar os dados antigos e formatar a unidade em **FAT32**.
   * *Nota:* Confirme a permissão de administrador (UAC) caso o Windows solicite para executar o formatador integrado.
7. Se escolheu o modo **Bloqueado / LT**, confirme que sua dashboard é a versão **17559** e que os avatares dos perfis estão coloridos.
8. Clique em **Preparar pendrive/HD** e aguarde até a conclusão.

### 📺 Como Usar no Xbox 360:
* **No Console RGH:**
  1. Plugue o pendrive/HD preparado com o videogame desligado.
  2. Ligue o console. A dashboard **Aurora** carregará automaticamente!
* **No Console Bloqueado ou LT (BadAvatar):**
  1. Desconecte a internet (cabo de rede e Wi-Fi) — o console deve ficar **totalmente offline**.
  2. Se o console tiver login automático no seu perfil pessoal, faça **Logout/Sair**.
  3. Na tela de seleção de perfis, localize o perfil do exploit (ele possui uma senha/PIN proposital). **Não tente fazer login no perfil do exploit.**
  4. Permaneça na tela de seleção de perfis por 30s a 2 minutos enquanto o console lê o avatar modificado.
  5. A tela piscará e a **Aurora** carregará automaticamente.
  6. Dentro da Aurora, faça **Sign In** no seu perfil pessoal para jogar e salvar seu progresso.

---

## 4. Enviando Jogos via Rede (FTP)

Uma vez que a Aurora esteja rodando no Xbox RGH, você pode transferir jogos diretamente pela rede local.

### 📋 Requisitos para a Rede
* Console **RGH** com a dashboard **Aurora** aberta e conectado à mesma rede local (roteador) do computador.
* Servidor FTP ativado no Aurora: No controle, vá em **Start** ➡️ **Settings** ➡️ **Network** ➡️ Marcar **Enable FTP Server**.

### 🛠️ Passo a Passo da Transferência:
1. Na tela inicial do Xbox 360 Companion no PC, clique em **Preparar Pendrive / HD** ➡️ selecione **Xbox Desbloqueado RGH** ➡️ clique em **Avançar** ➡️ escolha **Enviar direto para o Xbox (Rede)** (*Apenas RGH + Aurora*).
2. Clique em **Procurar Xbox na Rede** para busca automática, ou digite manualmente o IP do videogame exibido no canto inferior esquerdo da tela do Aurora. Clique em **Conectar**.
3. O aplicativo sincronizará automaticamente o pacote de scripts (`aurora-scripts`) para a pasta de scripts do Aurora no console.
4. **No Xbox 360:** Abra o menu de **Scripts** no Aurora e selecione **Xbox 360 Companion**.
5. Pelo controle do videogame na TV, navegue pelas bibliotecas disponíveis (Internet Archive, Minerva ou armazenamento local do PC).
6. Selecione o jogo, defina a unidade de destino (`Hdd1` para HD interno ou `Usb0` para USB) e confirme a instalação.
7. O aplicativo no PC baixará, descompactará e transmitirá o jogo via FTP em tempo real.

---

## 5. Estrutura de Pastas e Configuração de Capas no Aurora (Scan Paths)

### 📁 Estrutura Automática de Armazenamento
O Xbox Companion salva cada tipo de jogo na pasta apropriada:
* **Formato GOD (Games On Demand):** Gravado em `Hdd1:\Content\0000000000000000\` ou `Usb0:\Content\0000000000000000\`.
* **Formato XEX (Extraído):** Gravado em `Hdd1:\Games\<NomeDoJogo>\` ou `Usb0:\Games\<NomeDoJogo>\`.

### 🖼️ Configurando o Escaneamento de Capas no Aurora (Scan Paths)
Para que os jogos instalados apareçam na sua biblioteca do Aurora com capas e informações:

1. No Aurora, pressione **Start** no controle.
2. Acesse **Content** (Conteúdo) ➡️ **Manage Paths** (Gerenciar Caminhos).
3. Pressione **Y** (**Add Path** / Adicionar Caminho).
4. Em **Change Path**, selecione a pasta onde os jogos estão salvos (`Hdd1:\Content\0000000000000000\`, `Usb0:\Content\0000000000000000\`, `Hdd1:\Games\` ou `Usb0:\Games\`).
5. Ajuste a **Scan Depth** (Profundidade de Busca) para **2** ou **3**.
6. Pressione **X** para salvar o caminho.
7. O Aurora realizará o escaneamento e baixará automaticamente as capas e sinopses via internet!

---

## 6. Resolução de Problemas (FAQ)

* **Os perfis/avatares no console travado estão cinzas (silhuetas):**
  * O exploit BadAvatar exige a atualização de avatares no console. Instale a atualização oficial offline na versão 17559 (https://www.xbox.com/system-update-usb, link também na tela *Preparar dispositivo*), extraindo o ZIP na raiz de um pendrive FAT32: a pasta `$SystemUpdate` fica na raiz, com o nome oficial, sem renomear.
* **O formatador avisa que não consegue formatar o pendrive:**
  * Feche o Windows Explorer ou qualquer programa que esteja acessando arquivos da unidade USB e tente novamente.
* **Transferência via rede lenta ou desconectando:**
  * A placa Wi-Fi original do Xbox 360 é antiga. Para transferências rápidas e estáveis de jogos grandes (mais de 8 GB), conecte o console ao roteador via **cabo de rede (RJ45)**.
