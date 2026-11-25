# Guia Definitivo: Como Usar o Xbox 360 Companion (Para Iniciantes) 🎮

O **Xbox 360 Companion** é um aplicativo completo para computadores que permite baixar jogos de Xbox 360 diretamente em qualquer pasta do PC (sem precisar de pendrive), preparar pendrives ou HDs externos para rodar no console e enviar jogos, DLCs e atualizações pela rede local.

Logo ao abrir o aplicativo, você verá duas opções claras na tela inicial:
1. **Catálogo de Jogos (*Sem precisar de pendrive*)**: Para ir direto para a lista de jogos e salvar os arquivos em **qualquer pasta do seu computador** (ou em um pendrive já preparado).
2. **Preparar Pendrive / HD (*Passo a passo guiado*)**: Para formatar e instalar o menu **Aurora** no seu pendrive/HD externo (com suporte a consoles destravados com RGH ou travados/LT usando o exploit BadAvatar) ou configurar o envio por **Rede (FTP)** em consoles RGH.

Abaixo está o passo a passo completo de todas as opções.

---

## 📁 PASSO A PASSO 1: Baixando Jogos Direto em uma Pasta do Computador (Sem Pendrive)
Use esta função se você quer apenas baixar os arquivos dos jogos para o seu computador ou HD externo, sem obrigar a ter um pendrive conectado.

1. Abra o **Xbox 360 Companion** no computador.
2. Na tela inicial, clique em **Catálogo de Jogos** (*Sem precisar de pendrive*).
3. Procure o jogo desejado na lista ou digite o nome na barra de pesquisa.
4. Clique no jogo (se houver várias regiões/edições, clique na versão que preferir).
5. Em **Onde você quer salvar este jogo?**, selecione **Pasta no PC** (essa opção já fica marcada sozinha quando não há pendrive conectado).
6. Clique em **Salvar em uma pasta…** (ou **Escolher pasta e baixar todos os N discos** em jogos de mais de 1 disco).
7. O Windows abrirá a janela padrão de pastas: escolha onde quer salvar (Downloads, Documentos, HD externo, etc.) e confirme.
8. O download começa automaticamente em segundo plano! Acompanhe na aba **Fila** até aparecer **Pronto**.

---

## 💾 MÉTODO 1: Preparando o seu Pendrive ou HD Externo (USB)
Use esta função para preparar o dispositivo que vai guardar os seus jogos e carregar o menu alternativo **Aurora** no Xbox.

### 📋 Requisitos para o USB
* Um pendrive ou HD externo USB de no mínimo 8 GB (recomendado 32 GB ou mais para caber vários jogos).
* O aplicativo **Xbox 360 Companion** aberto no computador: [Baixar Versão Portátil](https://gofile.io/d/pnHMrf).
* Pelo menos **2 GB livres no disco C:** do computador. O programa usa esse espaço toda vez que abre, mesmo que o arquivo baixado esteja em outro disco; se faltar, ele avisa quanto é preciso liberar.

### 🛠️ Passo a Passo da Preparação:
1. Abra o **Xbox 360 Companion** no computador.
2. Na tela inicial, clique em **Preparar Pendrive / HD** (*Passo a passo guiado*).
3. **Selecione o tipo de desbloqueio do seu Xbox 360** e clique em **Avançar**:
   * **Xbox Desbloqueado RGH**: Se o seu videogame liga na tela azul do XeLL ao ligar pelo botão de ejetar CD. O instalador vai gravar a Aurora e o arquivo de boot automático (`launch.ini`).
   * **Xbox Bloqueado ou LT**: Se o seu videogame é travado ou roda jogos piratas apenas em mídia física (DVD). O instalador vai configurar o **BadAvatar** (exploit temporário que inicia a Aurora de forma segura).
4. Na tela seguinte, selecione a opção **Gravar em um Pendrive ou HD** (identificada pela etiqueta *Bloqueado / LT / RGH*).
5. Conecte o pendrive ou HD externo na porta USB do computador e clique em **Atualizar**.
6. Selecione a unidade correspondente ao seu pendrive/HD na lista.
7. **Formatar antes (Altamente Recomendado)**: Marque a caixinha **Formatar antes** para apagar todos os dados antigos e formatar o dispositivo no padrão **FAT32** (o único que o Xbox 360 reconhece).
   * *Atenção:* O Windows abrirá uma janela do Controle de Conta de Usuário (UAC) pedindo permissão de administrador para rodar o formatador. Clique em "Sim".
8. Se escolheu o modo **Bloqueado/LT**, marque a caixinha confirmando que aceita os requisitos (sua dashboard deve ser a versão 17559 e os avatares dos perfis devem estar coloridos, não cinzas).
9. Clique no botão **Preparar pendrive/HD** e aguarde a barra de progresso chegar a 100%.

### 📺 Como usar o Pendrive/HD no Xbox 360:
* **Se o seu console é RGH**: 
  1. Com o videogame desligado, plugue o pendrive/HD preparado na porta USB dele.
  2. Ligue o videogame. Ele carregará a interface **Aurora** automaticamente!
* **Se o seu console é Bloqueado ou LT (Exploit BadAvatar)**:
  1. Certifique-se de que o cabo de rede está desconectado e o Wi-Fi desativado (o console deve ficar **totalmente offline**).
  2. Se o seu console possui **Login Automático** ativado para o seu perfil pessoal, faça Logout/Sair dele para voltar à tela de escolha de perfis do Xbox oficial.
  3. Na tela de escolha de perfis, localize o perfil do exploit vindo do pendrive (ele possui uma senha/PIN de segurança proposital para evitar que você tente fazer login nele).
  4. **Não tente entrar ou fazer login no perfil do exploit**. Apenas permaneça parado na tela de escolha de perfis enquanto o console lê o dispositivo e carrega o avatar modificado dele.
  5. Após alguns segundos (geralmente entre 30s e 2 minutos), a tela piscará e o console carregará o menu **Aurora** automaticamente.
  6. Uma vez dentro da Aurora, você pode entrar (Sign In) no seu perfil pessoal para carregar seus jogos e salvar o progresso.
  * *Observação:* Como este desbloqueio é temporário, você precisará deixar o console na tela de escolha de perfis toda vez que ligar o videogame para activar a Aurora.

---

## 🌐 MÉTODO 2: Enviando Jogos via Rede (Sem tirar o pendrive do Xbox)
Depois que a Aurora estiver rodando no seu Xbox (seja por RGH ou pelo exploit BadAvatar no pendrive), você pode transferir jogos do computador para o videogame usando a rede local.

### 📋 Requisitos para a Rede
* O Xbox 360 deve ser **Desbloqueado (RGH)**, estar com o menu Aurora aberto e conectado no mesmo roteador que o computador. *Consoles bloqueados ou com LT não suportam este método.*
* Ative o FTP na Aurora: **Start** no controle ➡️ **Settings** ➡️ **Network** ➡️ Marcar **Enable FTP Server**.

### 🛠️ Passo a Passo da Transferência:
1. Na tela inicial do Xbox 360 Companion no computador, clique em **Preparar Pendrive / HD**, escolha **Xbox Desbloqueado RGH** ➡️ **Avançar** ➡️ e selecione **Enviar direto para o Xbox (Rede)** (identificada pela etiqueta *Apenas RGH + Aurora*).
   * *Importante:* Consoles Bloqueados ou destravados por LT não suportam conexões FTP de rede e devem usar a transferência via pendrive (Método 1).
2. Clique em **Procurar Xbox na Rede**. O programa varrerá sua rede local para encontrar o videogame sozinho.
3. Se ele não achar automaticamente, olhe o IP do videogame no canto inferior esquerdo da tela da Aurora e digite-o no campo **Digitar IP manualmente**. Clique em **Conectar**.
4. O programa salvará os dados e enviará automaticamente os scripts integrados para a pasta da Aurora no videogame.
5. **No Xbox**: Abra o menu de **Scripts** na Aurora e selecione **Xbox 360 Companion**.
6. Pelo controle do videogame, você pode navegar pelas bibliotecas online (Minerva, Internet Archive) ou pelos arquivos locais do PC.
7. Selecione o jogo, escolha a unidade (`Hdd1` para HD interno ou `Usb0` para o pendrive/HD externo conectado) e confirme a instalação.
8. O computador vai baixar o jogo, convertê-lo e transmiti-lo de volta para o videogame via rede. Você verá o progresso em tempo real na TV!

---

## 📂 Opção de Cópia Direta no Pendrive (Mais Rápido para Grandes Volumes)
Se você não quiser usar a rede para passar os jogos (o que pode ser lento no Wi-Fi), você pode baixar e gravar os jogos direto no seu pendrive/HD USB preparado usando o computador:

1. Conecte o pendrive/HD já preparado no computador.
2. Abra o **Catálogo de Jogos** (ou clique em **Baixar Jogos** no topo).
3. Clique no jogo desejado, escolha **Pendrive (USB)**, selecione a unidade do seu pendrive na lista e clique em **Adicionar à fila**.
4. Os jogos serão baixados, convertidos e gravados diretamente no pendrive preparado, sem precisar usar a rede! (Se quiser apenas guardar os arquivos no computador, escolha **Pasta no PC** -> **Salvar em uma pasta…**).

---

## ❓ Resolução de Problemas Comuns (FAQ)

* **Os perfis ou avatares do meu console travado estão cinzas (silhuetas). O que fazer?**
  * O BadAvatar precisa que a atualização de avatares esteja instalada no console para funcionar. Siga o tutorial de atualização offline no aplicativo (*Preparar dispositivo > Como corrigir os avatares cinzas*): ele tem o link oficial da Microsoft. Extraia o ZIP na raiz de um pendrive em FAT32 e deixe a pasta `$SystemUpdate` com o nome oficial, sem renomear.
* **O formatador diz que não pode formatar o pendrive.**
  * Certifique-se de fechar qualquer pasta ou programa (como o Explorer ou antivírus) que esteja lendo arquivos do pendrive no momento e tente novamente.
* **A transferência por rede está caindo ou muito lenta.**
  * A placa de rede sem fio (Wi-Fi) do Xbox 360 é muito antiga. Para jogos de mais de 8 GB, sempre conecte o Xbox 360 ao roteador usando um **cabo de rede**. Isso estabiliza a conexão e acelera a transferência em até 5 vezes.
