# Base de Conhecimento de Suporte ao Cliente — Xbox 360 Companion 💬

> **Público-Alvo:** Agentes de Suporte (Humano ou Bots de Atendimento via WhatsApp / Chat)  
> **Objetivo:** Fornecer roteiros de atendimento passo a passo, árvore de decisão por tipo de console e respostas prontas para resolução de problemas sem termos técnicos de programação.  
> **Aplicação:** Xbox 360 Companion  
> **Idioma:** Português (Brasil)  

---

## 📌 MÓDULO 1: Diretrizes de Atendimento e Triagem no WhatsApp

Ao atender um usuário no WhatsApp, mantenha uma linguagem **simples, amigável, didática e direta**. Evite termos computacionais avançados (como "CGO", "SQLite", "JNI", "IPC") e foque na experiência do usuário.

### 🔍 Perguntas de Triagem Inicial (Envie para identificar o caso do cliente):

> *"Olá! Para te ajudar a configurar o **Xbox 360 Companion** da forma correta, me responda essas 3 perguntinhas rapidas:"*
> 1. **Qual o tipo do seu Xbox 360?**
>    - ( ) Travado de fábrica (Bloqueado)
>    - ( ) Desbloqueado LT (Roda discos piratas em DVD)
>    - ( ) Desbloqueado RGH / JTAG (Liga com tela azul do XeLL ou entra na Aurora direto)
> 2. **Onde você quer colocar os seus jogos?**
>    - ( ) Em um Pendrive ou HD Externo USB
>    - ( ) No HD Interno original do próprio Xbox 360
> 3. **Você pretende passar os jogos usando Cabo/Wi-Fi pela rede ou gravando direto no Pendrive pelo computador?**

---

## 📌 MÓDULO 2: Matriz de Soluções por Tipo de Console / Desbloqueio

---

### 🟢 CENÁRIO A: Xbox 360 Travado de Fábrica ou com Desbloqueio LT 2.0 / LT 3.0

> **Explicação para o Cliente:** *"O Xbox 360 Companion permite rodar a dashboard Aurora e colocar jogos no seu Xbox mesmo ele sendo travado de fábrica ou LT, sem precisar abrir o videogame nem perder a garantia! Usamos a tecnologia **BadAvatar USB**."*

#### 📋 Requisitos Obrigatórios que o cliente deve confirmar:
1. O console deve estar na versão de sistema (Dashboard) **17559**.
2. Os avatares dos perfis devem estar **coloridos** (se estiverem cinzas/silhuetas, veja o Módulo 5 de Solução de Problemas).
3. O console deve ser mantido **TOTALMENTE OFFLINE** (desconecte o cabo de rede e o Wi-Fi).

#### 🛠️ Passo a Passo para Enviar no WhatsApp:

1. **No Computador:**
   * Conecte um pendrive de no mínimo 8 GB (recomendado 32 GB ou mais) no computador.
   * Abra o aplicativo **Xbox 360 Companion** no PC.
   * Na tela inicial, clique em **Gravar em um Pendrive ou HD** (*Bloqueado / LT / RGH*).
   * Escolha a opção **Xbox Bloqueado ou LT**.
   * Selecione a letra do seu pendrive na lista e marque a caixinha **Formatar antes** (o próprio app vai formatar em FAT32 sozinho).
   * Marque a confirmação dos requisitos e clique no botão **Preparar pendrive/HD**. Aguarde chegar a 100%.

2. **No Xbox 360:**
   * Com o videogame desligado e sem internet, espete o pendrive preparado na porta USB.
   * Ligue o videogame. Se o seu perfil pessoal entrar sozinho, faça **Logout / Sair** dele para voltar à tela de seleção de perfis do Xbox.
   * Na tela de escolha de perfis, você verá o perfil do exploit vindo do pendrive. **ATENÇÃO: Não tente fazer login no perfil do exploit!**
   * Apenas permaneça parado na tela de seleção de perfis. Entre 30 segundos e 2 minutos, a tela piscará e o menu **Aurora** carregará automaticamente!
   * Assim que a Aurora abrir, faça login no seu perfil pessoal para jogar e salvar seu progresso.

---

### 🟢 CENÁRIO B: Xbox 360 com Desbloqueio RGH ou JTAG (Chip / Softmod Definitivo)

> **Explicação para o Cliente:** *"Consoles RGH podem instalar a Aurora de forma permanente e aceitam transferência de jogos direto pela rede local (Wi-Fi ou cabo), sem precisar ficar tirando o pendrive do videogame!"*

#### 🛠️ Opção 1: Primeira Instalação da Aurora via USB
1. Conecte o pendrive no PC.
2. No Xbox Companion, escolha **Gravar em um Pendrive ou HD** ➔ **Xbox Desbloqueado RGH**.
3. Marque **Formatar antes** e selecione o pendrive.
4. Clique em **Preparar pendrive/HD**.
5. Coloque o pendrive no Xbox RGH e ligue: ele abrirá a Aurora automaticamente pelo arquivo `launch.ini`.

#### 🛠️ Opção 2: Se o cliente já tem a Aurora rodando no RGH
* Não precisa formatar nem regravar o pendrive! O cliente pode enviar jogos direto por **Rede (FTP)** ou copiar arquivos locais (veja o Módulo 3).

---

## 📌 MÓDULO 3: Métodos de Transferência de Jogos

---

### 📡 Método 1: Enviando Jogos pela Rede (Wi-Fi ou Cabo RJ45)

> **Ideal para:** Consoles RGH ou consoles travados com a Aurora já aberta via BadAvatar, que estejam conectados na mesma rede/roteador do computador.

#### 🛠️ Passo a Passo para Enviar ao Cliente:

1. **No Xbox 360 (Ativar o Servidor FTP):**
   * Na Aurora, pressione **Start** no controle ➡️ **Settings** ➡️ **Network** ➡️ Marque a opção **Enable FTP Server**.
   * Observe o número de **IP** que aparece no canto inferior esquerdo da tela da TV (exemplo: `192.168.1.100`).

2. **No Computador (Xbox Companion):**
   * Abra o Xbox Companion no PC e clique em **Enviar direto para o Xbox (Rede)**.
   * Clique em **Procurar Xbox na Rede** ou digite o IP do console no campo e clique em **Conectar**.
   * O aplicativo enviará os scripts de comunicação para a Aurora no videogame automaticamente.

3. **Na TV pelo Console:**
   * Abra o menu de **Scripts** dentro da Aurora no Xbox.
   * Selecione **Xbox 360 Companion**.
   * Use o controle do videogame para navegar pelos jogos (Minerva Archive, Internet Archive ou arquivos do PC).
   * Escolha o jogo, selecione a unidade onde quer salvar (`Hdd1` para HD interno ou `Usb0` para pendrive/HD externo) e confirme a instalação.
   * O computador baixará, converterá e enviará o jogo sozinho para o Xbox!

---

### 💾 Método 2: Cópia Direta no Pendrive/HD USB (Sem Usar a Rede)

> **Ideal para:** Quem tem internet Wi-Fi lenta no Xbox ou prefere gravar os jogos no pendrive direto pelo computador.

#### 🛠️ Passo a Passo para Enviar ao Cliente:
1. Espete o pendrive/HD USB (já preparado com a Aurora) no computador.
2. No Xbox Companion no PC, clique no ícone de engrenagem (**⚙️ Configurações / Settings**).
3. Altere o caminho de **Local Transfer folder** (ou Pasta Local) apontando para a letra do seu pendrive/HD USB.
4. Ao navegar e baixar os jogos no app no PC, selecione a opção de gravação local. Os jogos serão baixados e salvos diretamente no seu pendrive/HD externo!
5. Depois é só plugar a mídia no Xbox 360 e jogar.

---

### 💿 Método 3: O Cliente Já Tem o Arquivo ISO no Computador

> **Explicação para o Cliente:** *"Você não precisa baixar o jogo de novo! O Xbox Companion converte o seu arquivo `.ISO` local e coloca no formato correto automaticamente."*

#### 🛠️ Passo a Passo:
1. Abra o Xbox Companion no PC.
2. No menu de ferramentas, selecione **ISO to GOD** ou **ISO to XEX**.
3. Clique em **Selecionar ISO** e escolha o arquivo do seu computador.
4. Escolha o destino: você pode enviar direto via Rede (FTP) para o Xbox ou salvar em uma pasta/pendrive no computador.
5. Clique em **Converter**. O aplicativo fará o processo nativamente sem precisar do Iso2God antigo!

---

### 🎮 Método 4: Jogos com 2 Discos (Multi-Disco)

> **Explicação para o Cliente:** *"Jogos de 2 discos (como GTA V, Red Dead Redemption, Skyrim, Call of Duty) funcionam perfeitamente no Xbox Companion sem complicação!"*

* **Como Funciona:**
  * **Disco 1 (Jogo Principal):** É instalado como **GOD** (Games On Demand) normal.
  * **Disco 2 (Conteúdo Obligatório / DLC):** O Xbox Companion identifica automaticamente e marca como **[Recomendado] (Content/DLC)**. Os arquivos do Disco 2 são salvos automaticamente na pasta interna de conteúdos (`Content\0000000000000000\<TitleID>\00000002\`).
* **Orientação ao Cliente:** Sempre escolha a opção marcada como **[Recomendado]** pelo aplicativo na hora de instalar o Disco 2!

---

## 📌 MÓDULO 4: Recursos Adicionais (Capas, Saves, DLCs e TUs)

### 🎨 1. Como Arrumar ou Trocar Capas de Jogos
Se um jogo estiver sem capa na Aurora:
1. No Xbox Companion no PC, vá na aba **Xbox Library** (Biblioteca Xbox).
2. Abra o jogo desejado e vá na seção **Editor de Artes (Asset Editor)**.
3. Clique em **Buscar** (o app busca capas em alta definição na internet) ou escolha uma foto do PC.
4. Clique em **Salvar no Console**. A capa aparecerá na TV imediatamente!

### 💾 2. Como Fazer Backup de Todos os Saves e Perfis
1. No Xbox Companion no PC, vá em **Xbox Library** ou **Configurações**.
2. Abra a opção **Save Game Backup** e clique em **Fazer Backup de Todos os Perfis**.
3. O app copiará todos os perfis e saves do videogame para o PC, organizados pelo nome de cada jogador (Gamertag).

### 🧩 3. Baixar DLCs e Atualizações (Title Updates - TUs)
1. Na **Xbox Library** no PC, abra o jogo.
2. Expanda a seção **DLC & Title Updates**.
3. Clique em **Instalar** no conteúdo desejado.
4. Para mudar a versão da atualização ativa do jogo, clique no botão **Ativo / Inativo** (o app renomeia as outras TUs com `.disabled` automaticamente para não dar conflito).

---

## 📌 MÓDULO 5: Resolução de Problemas no WhatsApp (FAQ & Troubleshooting)

Utilize as respostas prontas abaixo para enviar diretamente ao cliente quando ele relatar problemas:

---

#### ❓ 1. "Os perfis/avatares do meu console travado estão cinzas (silhuetas) e o BadAvatar não abre."

> **Resposta Pronta:**
> *"Olá! Para o desbloqueio BadAvatar funcionar no Xbox travado, os avatares do videogame precisam estar atualizados. Quando eles estão cinzas, significa que falta a atualização de sistema.*
> 
> **Como resolver:**
> 1. Baixe a atualização offline oficial da versão **17559**.
> 2. Coloque a pasta com o nome **`$$SystemUpdate`** na raiz de um pendrive formatado em FAT32.
> 3. Desconecte a internet do Xbox, insira o pendrive e ligue o console. Ele pedirá para atualizar os avatares. Aceite a atualização.
> 4. Assim que os avatares ficarem coloridos, execute o preparador do Xbox Companion novamente no pendrive!"*

---

#### ❓ 2. "O programa deu erro dizendo que não conseguiu formatar o pendrive."

> **Resposta Pronta:**
> *"Esse aviso acontece quando o próprio Windows está usando o pendrive em segundo plano.
> 
> **Como resolver:**
> 1. Feche qualquer pasta do pendrive que esteja aberta no seu computador.
> 2. Quando você clicar em 'Preparar' no Xbox Companion, o Windows vai exibir uma janelinha perguntando se autoriza o aplicativo a fazer alterações (Aviso de Administrador/UAC). Clique em **SIM**.
> 3. Se persistir, retire o pendrive, insira em outra porta USB do computador e tente novamente!"*

---

#### ❓ 3. "O jogo foi transferido mas não está aparecendo na tela da Aurora no Xbox."

> **Resposta Pronta:**
> *"Não se preocupe! O jogo já está no seu HD, apenas precisamos mandar a Aurora procurar na pasta certa.
> 
> **Passo a passo no controle do Xbox:**
> 1. Na tela da Aurora, pressione o botão **Start** no controle.
> 2. Vá em **Content** (Conteúdo) ➡️ **Manage Paths** (Gerenciar Caminhos).
> 3. Pressione o botão **Y** para adicionar um novo caminho.
> 4. Escolha a pasta onde seus jogos foram salvos (exemplo: `Usb0:\Games\` ou `Hdd1:\Content\0000000000000000\`). Pressione **Y** para selecionar.
> 5. Altere a opção **Scan Depth** (Profundidade de busca) para o número **2** ou **3**.
> 6. Pressione **X** para salvar. A Aurora fará a varredura e o jogo aparecerá na tela com a capa!"*

---

#### ❓ 4. "A transferência pela rede está muito lenta ou caindo toda hora."

> **Resposta Pronta:**
> *"A placa de Wi-Fi original do Xbox 360 é antiga e costuma oscilar com arquivos grandes.
> 
> **Como resolver:**
> 1. Para jogos grandes (mais de 8 GB), conecte o Xbox 360 ao seu roteador usando um **cabo de rede (RJ45)**. A velocidade aumenta em até 5 vezes e não cai!
> 2. Caso só possa usar Wi-Fi, prefira usar o **Método de Cópia Direta no Pendrive** pelo computador, gravando o jogo direto no pendrive/HD USB sem usar a rede."*

---

#### ❓ 5. "O aplicativo diz que não encontrou o Xbox na rede."

> **Resposta Pronta:**
> *"Vamos conferir a conexão:
> 1. Certifique-se de que o computador e o Xbox 360 estão conectados na **mesma rede de Wi-Fi ou roteador**.
> 2. A tela da **Aurora deve estar aberta** no Xbox (o servidor FTP só funciona com a Aurora aberta).
> 3. Verifique o endereço de IP que aparece no canto inferior esquerdo da tela da TV e digite-o manualmente no campo de IP no aplicativo no PC."*

---

#### ❓ 6. "O jogo baixado pede o Disco 2 ao tentar iniciar no console."

> **Resposta Pronta:**
> *"Jogos de 2 discos precisam que o Disco 2 seja instalado na pasta de conteúdos.
> 
> **Como resolver:**
> Ao selecionar o Disco 2 no Xbox Companion, certifique-se de instalar com a opção **[Recomendado] (Content/DLC)**. O aplicativo enviará os arquivos de dados para a pasta correta do sistema e o jogo rodará perfeitamente ao abrir pelo Disco 1!"*

---

## 📌 MÓDULO 6: Resumo de Decisão Rápida para o Atendente (Cheat Sheet)

```
                       ┌────────────────────────────────────────┐
                       │  Qual o tipo de desbloqueio do cliente?│
                       └───────────────────┬────────────────────┘
                                           │
         ┌─────────────────────────────────┼─────────────────────────────────┐
         ▼                                 ▼                                 ▼
   [Xbox RGH / JTAG]             [Xbox Bloqueado / LT]              [Console sem Aurora]
         │                                 │                                 │
         ├─ Usar Aurora Nativa             ├─ Verificar Dash 17559           └─ Gravar Aurora ou
         ├─ Aceita FTP por Rede            ├─ Avatares Coloridos                BadAvatar USB pelo
         └─ Aceita HD Interno/USB          ├─ Usar BadAvatar USB                Xbox Companion
                                           └─ Usar em Modo Offline
```

Com este guia de suporte, o agente possui 100% das respostas necessárias para resolver qualquer dúvida do cliente de forma humanizada, direta e eficiente!
