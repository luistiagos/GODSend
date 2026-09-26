Fixtures próprias para os testes de progresso, sem conteúdo de jogos.

Ambos os arquivos contêm:
- game.iso: os 12 bytes ASCII de "iso payload" seguidos por LF.
- readme.txt: os 25 bytes ASCII de "archive progress fixture" seguidos por LF.

extraction-progress.7z foi criado com 7za a -t7z -m0=lzma2.
extraction-progress.rar é um RAR4 armazenado (método 0x30), com cabeçalhos
e CRC32 calculados sobre esses mesmos bytes. Não depende de um compressor RAR.
Os testes extraem e comparam o conteúdo completo das duas fixtures.
