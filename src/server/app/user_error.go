// user_error.go — translates raw technical pipeline/FTP errors into clear,
// layman-friendly Portuguese messages with actionable next steps for the user,
// while leaving raw technical details intact in logs and telemetry.
package app

import (
	"regexp"
	"strings"
)

var goTechnicalLeakRE = regexp.MustCompile(
	`(?i)(?:\b(?:dial\s+tcp|no\s+such\s+host|connection\s+(?:refused|reset|timed\s+out)|unexpected\s+EOF|EOF|TLS|x509|i/o\s+timeout)\b|` +
		`\b(?:ENOENT|EACCES|EPERM|EBUSY|ENOSPC|EROFS|EIO|ENODEV|ENXIO|EINVAL|ECONNREFUSED|ECONNRESET|ETIMEDOUT)\b|` +
		`\b(?:Get|Post|Head)\s+"?https?://|https?://[^\s]+|[A-Za-z]:\\[^\s]+|` +
		`\b(?:status\s*(?:401|403|404|500|502|503)|HTTP\s*(?:401|403|404|500|502|503))\b|` +
		`\b(?:Download\s+failed|Extract\s+failed|GOD\s+convert\s+failed|GOD\s+structure\s+detect\s+failed|IA\s+search\s+failed|HuggingFace\s+download\s+failed)\b|` +
		`\b(?:FTP\s+connect|FTP\s+upload|XEX\s+from\s+ISO|Archive\s+XEX|Invalid\s+game\s+name|ROM\s+not\s+found|Unknown\s+ROM\s+system)\b|` +
		`\b(?:Access\s+is\s+denied|permission\s+denied|not\s+enough\s+space|cannot\s+find\s+the\s+file|no\s+such\s+file)\b)`,
)

// FormatErrorForUser converts any technical error message destined for a
// user-facing status (such as JobQueue) into a layman-friendly Portuguese
// explanation with concrete next steps.
func FormatErrorForUser(raw string) string {
	msg := strings.TrimSpace(raw)
	if msg == "" {
		return "Não foi possível concluir esta tarefa agora. Clique em tentar novamente; se continuar falhando, feche e abra o aplicativo."
	}
	lower := strings.ToLower(msg)

	// 1. Missing local ISO or game unavailable in online catalog
	if strings.Contains(lower, "no iso in transfer folder") {
		return "O arquivo deste jogo (.iso) não foi encontrado na pasta Transfer do computador. Coloque o arquivo lá dentro e tente novamente."
	}
	if strings.Contains(lower, "jogo nao encontrado no catalogo") ||
		strings.Contains(lower, "not found in minerva") ||
		strings.Contains(lower, "not found in hugging face") ||
		strings.Contains(lower, "rom not found:") ||
		strings.Contains(lower, "unknown rom system:") {
		return "Este jogo não está disponível para download neste catálogo no momento. Tente escolher outra versão do jogo na lista ou tente novamente mais tarde."
	}
	if strings.Contains(lower, "invalid game name") {
		return "O nome deste jogo tem caracteres que não funcionam. Escolha outra versão do jogo na lista."
	}
	if strings.Contains(lower, "pacote huggingface corrompido") {
		return "Esta versão do jogo veio com defeito do servidor de origem e não funciona no console. Tente escolher outra versão na lista."
	}

	// 2. FAT32 4 GB limit
	if strings.Contains(lower, "limite maximo de 4 gb") ||
		strings.Contains(lower, "incompativel com pendrive fat32") {
		return "Este jogo tem um arquivo grande demais para caber nesse formato no pendrive. Baixe novamente escolhendo o formato GOD (ou outra versão do jogo)."
	}
	if strings.Contains(lower, "no default.xex in archive") {
		return "Esta versão do jogo não funciona no formato XEX. Baixe novamente escolhendo o formato GOD."
	}

	// 3. Disk space / local storage / permissions / disconnected drive
	if strings.Contains(lower, "nao ha espaco no disco do pc") ||
		strings.Contains(lower, "não há espaço no disco do pc") ||
		strings.Contains(lower, "ficou sem espaço") ||
		strings.Contains(lower, "espaço insuficiente no disco do pc") ||
		strings.Contains(lower, "espaco insuficiente no disco do pc") {
		return stripTechnicalSuffix(msg, "Libere espaço no disco do computador e clique em tentar novamente.")
	}
	if strings.Contains(lower, "espaço insuficiente no destino") ||
		strings.Contains(lower, "espaco insuficiente no destino") ||
		strings.Contains(lower, "no space left") ||
		strings.Contains(lower, "not enough space") ||
		strings.Contains(lower, "enospc") {
		return "Não há espaço livre suficiente no destino para gravar o jogo. Apague alguns arquivos antigos ou use um pendrive/HD maior e tente novamente."
	}
	if strings.Contains(lower, "desconectado") ||
		strings.Contains(lower, "nao esta pronto") ||
		strings.Contains(lower, "não está pronto") ||
		strings.Contains(lower, "dispositivo caiu") ||
		strings.Contains(lower, "enodev") ||
		strings.Contains(lower, "enxio") {
		return "O pendrive ou HD desconectou ou parou de responder durante a gravação. Tire e coloque ele em outra porta USB do computador e clique em tentar novamente."
	}
	if strings.Contains(lower, "erofs") || strings.Contains(lower, "read-only") {
		return "O pendrive ou HD está travado contra gravação. Verifique se há uma trava física nele e destrave, ou teste com outro pendrive ou HD."
	}
	if strings.Contains(lower, "access is denied") ||
		strings.Contains(lower, "acesso negado") ||
		strings.Contains(lower, "permission denied") ||
		strings.Contains(lower, "eperm") ||
		strings.Contains(lower, "eacces") ||
		strings.Contains(lower, "ebusy") {
		return "O Windows ou o antivírus bloqueou o acesso aos arquivos durante a cópia. Feche pastas abertas do dispositivo, pause o antivírus por alguns minutos e tente novamente."
	}

	// 4. FTP / Console connection
	if strings.Contains(lower, "530") || strings.Contains(lower, "login incorrect") {
		return "O Xbox 360 recusou o usuário ou a senha da conexão. Confira na Aurora do videogame e em “Configurações” se o usuário e a senha estão corretos."
	}
	if strings.Contains(lower, "ftp connect:") ||
		strings.Contains(lower, "ftp upload:") ||
		strings.Contains(lower, "ftp:") ||
		strings.Contains(lower, "xbox unreachable") {
		return "Não foi possível enviar o jogo para o seu Xbox 360. Confira se o videogame está ligado na Aurora, conectado na mesma rede do computador e com espaço livre, e tente novamente."
	}

	// 5. Network / Download / IA auth
	if strings.Contains(lower, "401") || strings.Contains(lower, "403") || strings.Contains(lower, "unauthorized") {
		return "O site onde o jogo está hospedado pediu login ou bloqueou o download agora. Entre com sua conta gratuita do Internet Archive em “Configurações” e tente novamente."
	}
	if strings.Contains(lower, "download failed") ||
		strings.Contains(lower, "download:") ||
		strings.Contains(lower, "ia search failed") ||
		strings.Contains(lower, "muito lento") ||
		strings.Contains(lower, "estagnado") ||
		strings.Contains(lower, "dial tcp") ||
		strings.Contains(lower, "no such host") ||
		strings.Contains(lower, "timed out") ||
		strings.Contains(lower, "connection reset") {
		return "Não foi possível baixar o jogo pela internet agora. Verifique se sua internet está funcionando, pause VPN ou antivírus se estiver usando, e clique em tentar novamente."
	}

	// 6. Archive extraction / ISO conversion
	if strings.Contains(lower, "extract failed") ||
		strings.Contains(lower, "extract:") ||
		strings.Contains(lower, "corrupt") ||
		strings.Contains(lower, "corromp") {
		return "O arquivo baixado veio incompleto ou danificado e não pôde ser aberto. Clique em tentar novamente para baixar uma cópia nova."
	}
	if strings.Contains(lower, "god convert failed") ||
		strings.Contains(lower, "god structure detect failed") ||
		strings.Contains(lower, "xex from iso:") ||
		strings.Contains(lower, "archive xex:") ||
		strings.Contains(lower, "compress:") ||
		strings.Contains(lower, "archive:") {
		return "Não foi possível preparar os arquivos deste jogo (o arquivo pode estar danificado ou o disco do computador ficou cheio). Libere espaço no computador e tente novamente."
	}

	// 7. Local write generic error
	if strings.Contains(lower, "gravação local:") || strings.Contains(lower, "gravacao local:") {
		return "Não foi possível gravar o jogo no pendrive ou HD. Confira se o dispositivo está bem conectado, com espaço livre, e clique em tentar novamente."
	}

	// 8. Panic / internal error
	if strings.Contains(lower, "erro interno ao processar:") {
		return "Ocorreu um erro inesperado ao preparar este jogo. Clique em tentar novamente; se continuar acontecendo, feche e abra o aplicativo."
	}

	// 9. If the message still has any technical jargon, replace with a safe fallback.
	if goTechnicalLeakRE.MatchString(msg) {
		return "Não foi possível concluir a instalação deste jogo agora. Confira sua internet, o espaço livre no computador e no dispositivo de destino, e clique em tentar novamente."
	}

	return msg
}

func stripTechnicalSuffix(msg, fallback string) string {
	if goTechnicalLeakRE.MatchString(msg) {
		return fallback
	}
	return msg
}
