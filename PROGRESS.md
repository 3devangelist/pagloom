# PROGRESS — Pagloom

Estado das tarefas em curso. Atualizado a cada passo.

## Tarefa atual: fotos do telefone → página (fase 1) — FEITA, por enviar ao GitHub
Pedido (25/10/2026): deteção da folha e das bordas em resolução total; HEIC + rotação EXIF; integração e README.

| Passo | Estado |
|---|---|
| Ler código (app.js, index.html, build) | feito |
| Bibliotecas: OpenCV.js 4.12.0 (@techstark/opencv-js, Apache-2.0) e libheif-js 1.23.2 (LGPL-3.0) no `fetch-libs.sh` | feito |
| Importação: HEIC/HEIF (libheif) e rotação EXIF dos JPEG | feito, testado no browser |
| Deteção da folha e das bordas (resolução total), grelha N×N — `web/photo.js` | feito, testado (ver Testes) |
| Ferramenta "Foto → página" (P): grelha arrastável com lupa, formato automático/normal/medida própria, Enter aplica | feito, testado no browser |
| Opção "Endireitar logo as fotos ao adicionar" (separador Página) | feito, testado no browser |
| README (EN e PT), CHANGELOG, THIRD_PARTY_LICENSES | feito |
| Servidor de teste sem compilar: `dev-server.js` + `testar-interface.bat` (exportações em `dev-out/`) | feito, a correr em http://127.0.0.1:8765/ |
| Fotos reais (25/10): folha branca sobre toalha de renda — a 1.ª versão falhava; agora deteta pela textura (papel liso) | feito: 12 de 12 fotos certas, só a 2 com o canto de cima à esq. um pouco fora |
| Multicore: `web/photo-worker.js` + conjunto de workers (até 8; este PC tem 24 núcleos, 64 GB) | feito: 3 fotos em 12 s (antes ~24 s); janela não bloqueia |
| Geometria pelo conteúdo (25/10): cantos por retas centrais (dobras não puxam, falta pintada da cor do papel); só perspetiva por omissão; curvatura só se as linhas (horizontais e verticais) a confirmarem; confiança alta/média/baixa com motivos; camada "mostrar análise" | feito: bancada 24 fotos reais — 22 alta/média, texto direito a 0,15–0,5 mm; 02 e 20 baixa (auto não mexe) |
| Bancada: `dev-out/testes/bench.html` (abre no servidor de teste; grava `dev-out/bench.jpg` e `bench.txt`) | feito; 24 fotos em ~38 s com 8 workers |
| Botão "Lote" (Shift+P): pergunta "da página X à página Y" (por omissão todas, ou a seleção), em paralelo; um Ctrl+Z desfaz tudo | feito: 6 fotos em 21 s, 4 endireitadas, 02 e 20 intactas; intervalo testado |
| Ferramentas Ângulo, Endireitar, Ponto branco/preto: botão Cancelar/Fechar (e Esc mesmo a escrever num campo) | feito, testado |
| Paralelo adaptado ao PC: Go devolve núcleos e memória livre (`memInfo` em ui_windows.go / ui_linux.go / other.go) na /api/info; workers = mín(núcleos−1, 8, memória livre×0,75 ÷ 0,6 GB por foto de 12 MP); pixels só quando há worker livre; falta de memória → baixa o limite e repete; opção "Fotos em paralelo" | feito e testado no browser (simulação de PC com 1,2 GB → 1 de cada vez). A parte Go só compila no GitHub |
| Uso real é o programa no Windows (WebView2); o browser é só para testes | nota do Ricardo, 25/10 |
| Retirado o "preenchimento dos cantos em falta" (pintava zonas com a cor do papel e inventava manchas): resultado = só deformação + recorte, pixels da foto, sem pintar nem mexer em cores | feito (pedido do Ricardo, 25/10) |
| Exportar (em cima) / Ctrl+E: janela com formato, páginas e resolução, depois "Guardar como"; servidor de teste passou a abrir o "Guardar como" do Windows (PowerShell); bancada grava por `/api/devsave` | feito; janela testada, "Guardar como" do servidor de teste por testar pelo Ricardo |
| Commit, push e tag (v1.2.0?) para o GitHub compilar | à espera do Ricardo |

## Pontos em aberto da geometria
- Fotos sintéticas com folha curvada: 0,78 mm (base) / 1,32 mm (forte); antes, com as bordas curvas, eram 0,44 / 1,16. Parte é distorção de lente simulada (os telemóveis já a corrigem). As fotos reais são a referência.
- Proporção pela perspetiva erra até ~8% em algumas fotos → A4 preferido (tolerância 10%).
- Eixo vertical (margens/colunas) só se aplica com medidas suficientes; nas fichas reais quase não chega a ser preciso.

## Fases seguintes (não pedidas ainda)
- Pontos interiores pelas linhas de texto e tabelas + modelo da lente (corrige o erro ao longo das bordas).
- Medidas personalizadas guardadas com nome (ex.: "Livro 155×235").
- Orientação leve, sem Tesseract (proposta 25/10, à espera de "avança"): deitada/de pé pelos perfis de linhas já medidos (eixo com perfil regular); 180° pela margem esquerda alinhada + hastes das letras (mais para cima em PT) + cabeçalho/rodapé; só roda se os sinais concordarem. Testar com as 24 fotos rodadas a 90/180/270°. ~1–1,5 h.
- Orientação pelo texto ao importar (pedido 25/10/2026): Tesseract.js (Apache-2.0) em modo de deteção de orientação, nos workers; roda 0/90/180/270° sem perda; se a confiança for baixa, não roda e avisa. Opção "Rodar pela orientação do texto ao adicionar" (ligada por omissão) + botão para as páginas selecionadas. Testar com as fotos deitadas (9, 10, 11). Estimativa 2–3 h; +~15 MB no programa.
- Depois disso, aproveitando o Tesseract: PDF pesquisável (texto selecionável por cima da imagem).

## Feito antes (também por enviar)
- Aviso ao fechar com páginas por exportar (Windows: WM_CLOSE; Linux/browser: beforeunload).
- Retirada a limitação "não importa TIFF" dos README.

## Testes (fotos sintéticas 3000×4000, A4 com marcas a cada 30 mm, fundo de madeira)
| Caso | Cantos | Bordas (perpendicular) | Marcas: erro médio / máximo | Proporção |
|---|---|---|---|---|
| De frente | < 1 px | 0,9 px | 0,18 / 0,23 mm | A4 |
| 18° + curvatura 5 mm + lente k1 −0,06 | < 1,2 px | 1,1–1,6 px | 0,44 / 0,81 mm | A4 |
| 35° + curvatura 9 mm + lente k1 −0,10 | < 1,4 px | 1,7–3,2 px | 1,08 / 2,28 mm | A4 |
O erro que sobra é ao longo das bordas (distorção da lente): corrige-se na fase seguinte.
Browser (Chromium): deteção ≈ 4,7 s por foto de 12 MP (inclui carregar o OpenCV na 1.ª vez); aplicar ≈ 1 s.
Testes e diagnóstico em `dev-out/testes/` (ignorado pelo git): `test.mjs` (fotos sintéticas, Node) e `diag.mjs` (folha de miniaturas com a borda detetada, corre na página do servidor de teste). Cópias de fotos reais em `dev-out/real_*.jpg`.

## Notas
- O OpenCV.js é "thenable": nunca fazer `await cv` nem devolvê-lo de uma função async (entra em ciclo). Esperar por `onRuntimeInitialized`.
- Compilação só pelo GitHub Actions (tag vX.Y.Z). O Go não está instalado no PC; as alterações em Go (aviso ao fechar) só são compiladas lá.
- A interface testa-se sem Go com `node dev-server.js` (ou `testar-interface.bat`).
- No browser escondido do Claude, o `requestAnimationFrame` para e a exportação fica parada em "PDF: página 1 de 1". Num browser visível isso não acontece.
- `web/lib/` está no .gitignore; localmente foi preenchida à mão para os testes.
