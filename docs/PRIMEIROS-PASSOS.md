# Primeiros passos e solução de problemas

Guia para quem vai **usar** o aplicativo para preparar um pendrive ou HD para o
Xbox 360. Não é necessário entender de programação.

## O que este aplicativo faz

Ele prepara um pendrive ou HD USB com o **BadAvatar** e o **Aurora** já
incluídos e configurados. Depois é só conectar o dispositivo no Xbox 360 e
ativar pelo perfil.

## O que ele **não** faz

- **Não desbloqueia o console de forma permanente.** O BadAvatar é temporário:
  toda vez que o Xbox liga ou reinicia, é preciso ativá-lo de novo pelo perfil.
- **Não modifica a memória interna do console.** Nada é gravado na NAND, na KV
  nem no MAC. Preparar o pendrive não tem como "brickar" o seu Xbox.
- **Não garante que o exploit vai funcionar** em todo console, nem de primeira.
  Às vezes leva algumas tentativas.

## Antes de começar

No **Xbox 360** que vai receber o pendrive:

1. O painel (dashboard) precisa ser a versão **17559** (`2.0.17559.0`).
2. Os **dados de Avatar** precisam estar instalados.
3. O console deve ficar **sem internet** durante o uso: desconecte o **Wi-Fi** e
   o **cabo de rede**.
4. **Nunca tente logar ou entrar na Xbox Live com o perfil do exploit.** Ele possui uma senha/PIN proposital e serve apenas para disparar o exploit na tela de perfis.

No **computador** você vai precisar de:

- um **pendrive ou HD USB** (com pelo menos 1 GB);
- o aplicativo aberto no **Windows** (a preparação automática só funciona no
  Windows nesta versão).

## Passo a passo

1. **Conecte** o pendrive ou HD numa porta USB do computador.
2. Na tela inicial, em **"Dispositivo conectado"**, confira se ele apareceu. Se
   não apareceu, clique em **Atualizar**.
3. (Opcional) Marque **"Formatar antes"** para apagar tudo e deixar o
   dispositivo em FAT32. O Windows vai pedir sua autorização antes de começar.
   > Formatar **apaga todos os arquivos** do dispositivo. Faça backup antes.
4. Marque a confirmação de que o console está no **dashboard 17559**, com os
   **dados de Avatar** e ficará **sem internet**.
5. Clique em **"Preparar pendrive/HD"** e aguarde a barra de progresso terminar.
6. Quando aparecer **"Pronto!"**, leve o dispositivo para o Xbox 360.

## No Xbox 360

1. Conecte o pendrive/HD preparado e certifique-se de que o console está totalmente offline.
2. Acesse a **Tela de Escolha de Perfis** (se o console fez login automático em sua conta pessoal, saia dela primeiro).
3. Permaneça na tela de perfis sem fazer login. O console tentará renderizar o avatar do perfil do exploit (que possui um PIN/senha para evitar que você logue nele).
4. O exploit disparará sozinho após alguns segundos (a tela piscará e abrirá a Aurora).
5. Dentro da **Aurora**, faça login no seu perfil pessoal para jogar e ter acesso aos seus saves.
6. Lembre: ao desligar ou reiniciar, é preciso **ativar de novo** repetindo estes passos.

## Solução de problemas

### O pendrive não aparece na lista
- Confira se ele está conectado direto numa porta USB e clique em **Atualizar**.
- Tente outra porta USB (de preferência traseira, no PC de mesa).

### Aparece "não pode ser usado"
A mensagem na tela explica o motivo e o que fazer. Os casos mais comuns:

| Mensagem | O que significa / o que fazer |
|---|---|
| Não é um pendrive/HD USB | O disco escolhido não é USB. Use um pendrive ou HD externo USB. |
| Disco do sistema / unidade do Windows / disco principal | Por segurança o aplicativo nunca usa o disco do computador. Escolha o pendrive. |
| Protegido contra gravação | Desative a trava de proteção do pendrive e clique em Atualizar. |
| Offline | Coloque o disco "online" no Gerenciamento de Disco do Windows. |
| Identificador não reconhecido | Tente outra porta USB ou outro pendrive. |
| Capacidade menor que 1 GB | Use um dispositivo de pelo menos 1 GB. |
| Mais de uma partição | Use um pendrive com partição única **ou** marque "Formatar antes". |

### A opção "Formatar antes" está desabilitada
O formatador FAT32 não veio nesta instalação. Você pode formatar o pendrive em
FAT32 pelo próprio Windows antes de preparar.

### Preparei, mas o exploit não ativa no console
- Confirme o **dashboard 17559** e os **dados de Avatar**.
- Confirme que o console está **sem internet**.
- Se o exploit não disparar, volte para a tela de escolha de perfis e aguarde novamente — o exploit pode demorar um pouco ou falhar de primeira, necessitando de nova tentativa de renderização da tela.

### "Pronto" apareceu — o console já está desbloqueado?
Não. **"Pronto"** quer dizer que o pendrive está preparado para uma tentativa no
console. Não é um desbloqueio permanente: repita a ativação a cada vez que ligar
o Xbox.

## Segurança

- Cada arquivo gravado no dispositivo é verificado.
- O aplicativo não consegue escolher por engano o disco interno/sistema.
- Uma interrupção durante a cópia não destrói arquivos fora do plano.
- Nada é gravado na memória interna do console (NAND/KV/MAC).
