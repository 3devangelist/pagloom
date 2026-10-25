// Pagloom — interface em português e inglês.
// O português é a língua de origem: os textos estão em PT no HTML e no código e são traduzidos aqui para EN
// quando aparecem no ecrã (um MutationObserver apanha o que o programa escreve). Nos modelos, {0}, {1}… são as
// partes variáveis; essas partes também passam pela tradução (ex.: "Erro a abrir: {0}").
const PAIRS = [
  // ── cabeçalho, barra de ferramentas, miniaturas
  ['Scanner & PDF Utility', 'Scanner & PDF Utility'],
  ['⎙ Digitalizar', '⎙ Scan'], ['Digitalizar', 'Scan'], ['Digitalizar (Espaço)', 'Scan (Space)'],
  ['＋ Adicionar PDF / imagens', '＋ Add PDF / images'], ['Adicionar PDFs ou imagens (Ctrl+O)', 'Add PDFs or images (Ctrl+O)'],
  ['↶ Desfazer', '↶ Undo'], ['↷ Refazer', '↷ Redo'], ['Desfazer (Ctrl+Z)', 'Undo (Ctrl+Z)'], ['Refazer (Ctrl+Y)', 'Redo (Ctrl+Y)'],
  ['Novo', 'New'], ['Começar um documento novo', 'Start a new document'],
  ['⇩ Exportar', '⇩ Export'], ['⇩ Exportar…', '⇩ Export…'], ['Exportar', 'Export'], ['Exportar (Ctrl+E)', 'Export (Ctrl+E)'],
  ['Língua da interface', 'Interface language'],
  ['Páginas', 'Pages'], ['Página', 'Page'], ['Todas', 'All'], ['Duplicar', 'Duplicate'], ['Apagar', 'Delete'],
  ['Selecionar todas (Ctrl+A)', 'Select all (Ctrl+A)'], ['Duplicar página', 'Duplicate page'], ['Apagar selecionadas (Delete)', 'Delete selected (Delete)'],
  ['Página anterior (←)', 'Previous page (←)'], ['Página seguinte (→)', 'Next page (→)'],
  ['Mover / navegar (H ou Esc)', 'Move / pan (H or Esc)'],
  ['⛶ Recortar', '⛶ Crop'], ['Recortar (C)', 'Crop (C)'], ['Recortar', 'Crop'],
  ['∠ Ângulo', '∠ Angle'], ['Rodar por ângulo (A)', 'Rotate by angle (A)'], ['Ângulo', 'Angle'],
  ['⟋ Endireitar', '⟋ Straighten'], ['Endireitar: desenha uma linha ao longo do texto (T)', 'Straighten: draw a line along the text (T)'],
  ['▱ Foto → página', '▱ Photo → page'], ['Foto → página', 'Photo → page'],
  ['Foto → página: encontra a folha numa foto e corrige a perspetiva, a curvatura e o tamanho (P)', 'Photo → page: finds the sheet in a photo and corrects perspective, curvature and size (P)'],
  ['▱ Lote', '▱ Batch'], ['Foto → página em todas as páginas selecionadas, várias ao mesmo tempo (Shift+P)', 'Photo → page on a range of pages, several at once (Shift+P)'],
  ['Ⓣ Ler texto', 'Ⓣ Read text'], ['Ⓣ Ler texto…', 'Ⓣ Read text…'], ['Ler o texto impresso das páginas (OCR, no próprio PC) — O', 'Read the printed text of the pages (OCR, on this PC) — O'],
  ['◻ Ponto branco', '◻ White point'], ['Clica numa zona que devia ser branca (W)', 'Click an area that should be white (W)'], ['Ponto branco', 'White point'],
  ['◼ Ponto preto', '◼ Black point'], ['Clica numa zona que devia ser preta (K)', 'Click an area that should be black (K)'], ['Ponto preto', 'Black point'],
  ['Auto níveis', 'Auto levels'], ['Níveis automáticos', 'Automatic levels'],
  ['Rodar 90° à esquerda (L)', 'Rotate 90° left (L)'], ['Rodar 90° à direita (R)', 'Rotate 90° right (R)'],
  ['Rodar 90° à esquerda', 'Rotate 90° left'], ['Rodar 90° à direita', 'Rotate 90° right'],
  ['Anterior + atual', 'Previous + current'], ['Mostrar a página anterior ao lado (D)', 'Show the previous page alongside (D)'],
  ['Ajustar', 'Fit'], ['Ajustar à janela (0)', 'Fit to window (0)'], ['Afastar (−)', 'Zoom out (−)'], ['Aproximar (+)', 'Zoom in (+)'],
  ['Sem páginas', 'No pages'], ['Carrega em', 'Press'], ['(ou Espaço), ou arrasta para aqui PDFs e imagens.', '(or Space), or drag PDFs and images here.'],
  ['Larga aqui para adicionar', 'Drop here to add'], ['A carregar…', 'Loading…'], ['A trabalhar…', 'Working…'],
  ['Página {0} (anterior)', 'Page {0} (previous)'], ['Página {0} (atual)', 'Page {0} (current)'], ['Página {0}', 'Page {0}'],
  ['Página PDF original (vetorial)', 'Original PDF page (vector)'],
  // ── separador Digitalizar
  ['Falta instalar', 'Missing'], ['Instalar agora', 'Install now'],
  ['Vai ser pedida a palavra-passe de administrador. Ou corre no terminal:', 'You will be asked for the administrator password. Or run in a terminal:'],
  ['Scanner', 'Scanner'], ['Procurar scanners', 'Look for scanners'], ['Origem', 'Source'],
  ['Vidro (mesa)', 'Flatbed (glass)'], ['Alimentador (ADF)', 'Document feeder (ADF)'], ['Alimentador — frente e verso', 'Document feeder — duplex'],
  ['Modo de cor', 'Colour mode'], ['Cor', 'Colour'], ['Tons de cinzento', 'Greyscale'], ['Preto e branco', 'Black and white'],
  ['Resolução de aquisição (ppp)', 'Scan resolution (dpi)'], ['Área', 'Area'],
  ['A4 (210 × 297 mm)', 'A4 (210 × 297 mm)'], ['Área total do scanner', 'Full scanner area'], ['A5 (148 × 210 mm)', 'A5 (148 × 210 mm)'], ['Carta (216 × 279 mm)', 'Letter (216 × 279 mm)'],
  ['Brilho', 'Brightness'], ['Contraste', 'Contrast'],
  ['Redigitalizar página atual', 'Rescan current page'], ['Digitalizar com janela do driver', 'Scan with the driver window'],
  ['As páginas novas entram a seguir à página atual.', 'New pages are inserted after the current page.'],
  ['As páginas novas entram a seguir à página atual. Em Linux usa o SANE (sane-utils; sane-airscan para scanners de rede).', 'New pages are inserted after the current page. On Linux this uses SANE (sane-utils; sane-airscan for network scanners).'],
  // ── separador Exportar
  ['Formato', 'Format'],
  ['PDF (um ficheiro, várias páginas)', 'PDF (one file, several pages)'], ['PNG (um ficheiro por página)', 'PNG (one file per page)'],
  ['JPEG (um ficheiro por página)', 'JPEG (one file per page)'], ['TIFF (um ficheiro, várias páginas)', 'TIFF (one file, several pages)'], ['SVG (um ficheiro por página)', 'SVG (one file per page)'],
  ['Selecionadas', 'Selected'], ['Só a atual', 'Current only'], ['Intervalo…', 'Range…'], ['ex.: 1-3, 5, 8-10', 'e.g. 1-3, 5, 8-10'],
  ['Resolução de exportação (ppp)', 'Export resolution (dpi)'],
  ['Nativa (sem alteração: imagem original, sem recomprimir)', 'Native (unchanged: original image, no recompression)'], ['Igual à original', 'Same as original'],
  ['Nas imagens só reduz, nunca aumenta. Nas páginas PDF que passam a imagem, é a resolução usada.', 'Images are only ever reduced, never enlarged. For PDF pages turned into images, this is the resolution used.'],
  ['Manter páginas PDF originais (texto e vetores)', 'Keep original PDF pages (text and vectors)'],
  ['Imagens sem perdas (PNG) — ficheiro maior', 'Lossless images (PNG) — larger file'],
  ['PDF pesquisável (texto lido por cima das imagens)', 'Searchable PDF (text read placed over the images)'],
  ['Qualidade JPEG', 'JPEG quality'], ['Último: {0}', 'Last: {0}'],
  ['Páginas a exportar: {0}', 'Pages to export: {0}'], ['Página atual: {0} mm', 'Current page: {0} mm'],
  ['{0} px a {1} ppp → {2} px a {3} ppp', '{0} px at {1} dpi → {2} px at {3} dpi'],
  ['Página PDF original (vetorial)', 'Original PDF page (vector)'], ['Página PDF original (protegida: sai como imagem)', 'Original PDF page (protected: exported as an image)'],
  ['A seguir escolhes a pasta e o nome do ficheiro. Mais opções (qualidade, PDF) no separador Exportar.', 'Next you choose the folder and file name. More options (quality, PDF) in the Export tab.'],
  ['Escolher pasta e exportar…', 'Choose folder and export…'], ['Cancelar', 'Cancel'],
  // ── separador Página
  ['Rasterizar páginas PDF a (ppp)', 'Rasterise PDF pages at (dpi)'],
  ['Recortar e rodar 90° mantêm as páginas PDF vetoriais. Ângulo livre, endireitar e níveis convertem a página em imagem a esta resolução.', 'Cropping and 90° rotation keep PDF pages as vectors. Free angle, straighten and levels turn the page into an image at this resolution.'],
  ['Foto → página: grelha de pontos', 'Photo → page: point grid'], ['Formato da folha', 'Sheet format'],
  ['Automático (pela perspetiva)', 'Automatic (from perspective)'], ['Ofício (216 × 356 mm)', 'Legal (216 × 356 mm)'], ['Outra medida…', 'Custom size…'],
  ['A3 (297 × 420 mm)', 'A3 (297 × 420 mm)'], ['A6 (105 × 148 mm)', 'A6 (105 × 148 mm)'],
  ['Endireitar logo as fotos ao adicionar', 'Straighten photos as they are added'],
  ['Livro ou manual aberto (duas páginas na foto)', 'Open book or manual (two pages in the photo)'],
  ['Dividir em duas páginas automaticamente', 'Split into two pages automatically'], ['Não dividir', 'Do not split'],
  ['Livro aberto: esquerda {0} | direita {1}', 'Open book: left {0} | right {1}'],
  ['Fotos em paralelo (núcleos a usar)', 'Photos in parallel (cores to use)'], ['Automático (pela memória livre e núcleos)', 'Automatic (from free memory and cores)'],
  ['Fotos do telefone (JPEG ou HEIC): a ferramenta Foto → página encontra a folha, corrige a perspetiva e a curvatura das bordas e põe a página no tamanho real.', 'Phone photos (JPEG or HEIC): the Photo → page tool finds the sheet, corrects perspective and edge curvature and sets the page to its real size.'],
  ['Atalhos', 'Shortcuts'],
  ['Espaço digitaliza · ← → páginas · Ctrl+Z / Ctrl+Y', 'Space scans · ← → pages · Ctrl+Z / Ctrl+Y'],
  ['C recortar · A ângulo · T endireitar · P foto → página · W ponto branco · K ponto preto · H/Esc mover', 'C crop · A angle · T straighten · P photo → page · W white point · K black point · H/Esc move'],
  ['R / L rodar 90° · D anterior+atual · 0 ajustar · + − zoom · roda do rato com Ctrl = zoom', 'R / L rotate 90° · D previous+current · 0 fit · + − zoom · Ctrl + mouse wheel = zoom'],
  ['Delete apaga · Ctrl+O adicionar · Ctrl+E exportar · arrasta miniaturas para reordenar', 'Delete deletes · Ctrl+O add · Ctrl+E export · drag thumbnails to reorder'],
  ['Este PC: {0} núcleos, {1} GB livres de {2} GB → automático: até {3} foto(s) de 12 MP em paralelo (limitado a {4} por falta de memória).', 'This PC: {0} cores, {1} GB free of {2} GB → automatic: up to {3} 12 MP photo(s) in parallel (limited to {4} for lack of memory).'],
  ['Este PC: {0} núcleos, {1} GB livres de {2} GB → automático: até {3} foto(s) de 12 MP em paralelo.', 'This PC: {0} cores, {1} GB free of {2} GB → automatic: up to {3} 12 MP photo(s) in parallel.'],
  ['Este PC: {0} núcleos → automático: até {1} foto(s) de 12 MP em paralelo.', 'This PC: {0} cores → automatic: up to {1} 12 MP photo(s) in parallel.'],
  ['Este PC: {0} núcleos', 'This PC: {0} cores'], ['{0} GB livres de {1} GB', '{0} GB free of {1} GB'],
  ['→ automático: até {0} foto(s) de 12 MP em paralelo', '→ automatic: up to {0} 12 MP photo(s) in parallel'],
  ['(limitado a {0} por falta de memória)', '(limited to {0} for lack of memory)'],
  ['Sem página.', 'No page.'], ['Imagem', 'Image'], ['Imagem — {0}', 'Image — {0}'],
  ['Página {0} de “{1}”', 'Page {0} of “{1}”'], ['PDF original (vetorial)', 'Original PDF (vector)'], ['Rotação: {0}°', 'Rotation: {0}°'], ['Recortada', 'Cropped'],
  // ── separador Texto
  ['Texto', 'Text'], ['Ler o texto sempre ao adicionar páginas', 'Always read the text when pages are added'],
  ['Detetar a língua automaticamente', 'Detect the language automatically'], ['Línguas do texto', 'Text languages'],
  ['Português', 'Portuguese'], ['Inglês', 'English'], ['Italiano', 'Italian'], ['Espanhol', 'Spanish'], ['Francês', 'French'],
  ['Com a deteção ligada, o programa escolhe sozinho entre estas cinco. Sem ela, usa as que marcares (cada língua a mais torna a leitura mais lenta).', 'With detection on, the program picks among these five by itself. Without it, it uses the ones you tick (each extra language makes reading slower).'],
  ['Texto da página atual', 'Text of the current page'], ['Copiar', 'Copy'], ['Guardar .txt…', 'Save .txt…'],
  ['Lido no próprio PC (Tesseract), sem enviar nada. Lê texto impresso; o manuscrito não sai fiável. No PDF exportado, o texto fica pesquisável e selecionável.', 'Read on this PC (Tesseract); nothing is sent anywhere. Reads printed text; handwriting is not reliable. In the exported PDF the text is searchable and selectable.'],
  ['(Esta página ainda não foi lida. Usa “Ler texto”.)', '(This page has not been read yet. Use “Read text”.)'],
  ['(PDF digital: o texto já está no PDF.)', '(Digital PDF: the text is already in the PDF.)'],
  ['(última: {0})', '(last: {0})'],
  // ── painéis das ferramentas
  ['Arrasta para marcar a área a manter. Ajusta pelos cantos.', 'Drag to mark the area to keep. Adjust by the corners.'],
  ['Selecionar tudo', 'Select all'], ['Aplicar recorte (Enter)', 'Apply crop (Enter)'], ['Cancelar (Esc)', 'Cancel (Esc)'], ['Fechar (Esc)', 'Close (Esc)'],
  ['· página PDF continua vetorial', '· PDF page stays vector'],
  ['Aplicar (Enter)', 'Apply (Enter)'], ['Repor', 'Reset'], ['Podes também arrastar na página para os lados.', 'You can also drag sideways on the page.'],
  ['Desenha uma linha ao longo de uma linha de texto, de uma margem ou de uma aresta da folha. Ao largar, a página fica direita.', 'Draw a line along a line of text, a margin or an edge of the sheet. When you let go, the page is straightened.'],
  ['Clica numa zona do papel que devia ser branca. As cores são corrigidas a partir desse ponto.', 'Click an area of the paper that should be white. Colours are corrected from that point.'],
  ['Clica numa zona que devia ser preta (texto ou tinta mais escura).', 'Click an area that should be black (text or the darkest ink).'],
  ['Foto → página em lote: da página', 'Photo → page in batch: from page'], ['à página', 'to page'], ['de {0}', 'of {0}'],
  ['Processar (Enter)', 'Process (Enter)'], ['Várias ao mesmo tempo; as de confiança baixa ficam como estão.', 'Several at once; low-confidence pages are left as they are.'],
  ['Prever malhas (Enter)', 'Preview grids (Enter)'], ['Mostra as malhas de todas para confirmares ou corrigires; só aplica no fim.', 'Shows the grids of all pages for you to confirm or fix; nothing is applied until the end.'],
  ['Rever as malhas: página {0} de {1}', 'Review the grids: page {0} of {1}'], ['Esta página não faz parte do lote.', 'This page is not part of the batch.'],
  ['Página anterior do lote (←)', 'Previous page of the batch (←)'], ['Página seguinte do lote (→)', 'Next page of the batch (→)'],
  ['Não dividir esta', 'Do not split this one'], ['Dividir esta (livro aberto)', 'Split this one (open book)'],
  ['Ignorar esta página', 'Skip this page'], ['Incluir esta página', 'Include this page'], ['(ignorada: fica como está)', '(skipped: left as it is)'],
  ['Aplicar todas (Enter)', 'Apply all (Enter)'], ['Ignorada: fica como está', 'Skipped: left as it is'], ['Malha proposta (por aplicar)', 'Proposed grid (not applied yet)'],
  ['Malhas propostas para {0} página(s). Confirma ou corrige cada uma (setas para mudar de página) e carrega em “Aplicar todas”.', 'Grids proposed for {0} page(s). Confirm or fix each one (arrow keys to change page) and press “Apply all”.'],
  ['Nesta página não encontrei duas páginas lado a lado.', 'I did not find two pages side by side on this page.'],
  ['Não encontrei a lombada: dividi ao meio. Acerta os pontos do meio sobre a lombada.', 'Spine not found: split down the middle. Move the middle points onto the spine.'],
  ['＋ Malha', '＋ Grid'], ['− Malha', '− Grid'], ['Apagar a malha ativa (ou clique direito em cima da malha)', 'Delete the active grid (or right-click on the grid)'],
  ['Remover esta malha (a realçada)?', 'Remove this grid (the highlighted one)?'],
  ['Acrescentar uma malha (uma página); depois arrasta os cantos para o sítio', 'Add a grid (one page); then drag its corners into place'],
  ['Fica pelo menos uma malha. Para não corrigir esta foto, usa “Ignorar esta página” ou “Cancelar”.', 'At least one grid must remain. To leave this photo uncorrected, use “Skip this page” or “Cancel”.'],
  ['{0} páginas nesta foto (malha ativa: {1})', '{0} pages in this photo (active grid: {1})'],
  ['Não há malhas para aplicar (todas ignoradas).', 'There are no grids to apply (all skipped).'],
  ['Foto → página aplicado: {0} foto(s) → {1} página(s).', 'Photo → page applied: {0} photo(s) → {1} page(s).'],
  ['Desistir da revisão? Os ajustes feitos às malhas perdem-se.', 'Give up the review? The changes made to the grids will be lost.'],
  ['Revisão cancelada: nada foi alterado.', 'Review cancelled: nothing was changed.'],
  ['Ler texto: da página', 'Read text: from page'], ['de {0} · línguas: {1}', 'of {0} · languages: {1}'], ['Ler (Enter)', 'Read (Enter)'], ['Línguas…', 'Languages…'],
  ['Em processamento…', 'Processing…'],
  ['Arrasta os pontos para as bordas da folha (Ctrl+roda para aproximar).', 'Drag the points onto the edges of the sheet (Ctrl+wheel to zoom).'],
  ['Grelha', 'Grid'], ['mostrar análise', 'show analysis'], ['Detetar de novo', 'Detect again'],
  ['PDF digital (texto e vetores): já está direito, não precisa de Foto → página. Serve para fotos e PDFs digitalizados.', 'Digital PDF (text and vectors): already straight, no need for Photo → page. It is meant for photos and scanned PDFs.'],
  ['{0} mm ({1})', '{0} mm ({1})'], ['{0} ppp', '{0} dpi'], ['{0} (automático)', '{0} (automatic)'],
  ['medida própria', 'custom size'], ['proporção medida, largura assumida de 210 mm — escolhe o formato', 'measured proportions, width assumed to be 210 mm — choose the format'],
  ['Carta', 'Letter'], ['Ofício', 'Legal'],
  ['confiança {0}', 'confidence {0}'], ['alta', 'high'], ['média', 'medium'], ['baixa', 'low'],
  ['pouco texto: só perspetiva', 'little text: perspective only'],
  ['corrigido pelo conteúdo ({0})', 'corrected from the content ({0})'], ['conteúdo já direito com a perspetiva ({0} mm)', 'content already straight with perspective ({0} mm)'],
  ['linhas: {0}, {1}', 'lines: {0}, {1}'], ['verticais: {0}, {1}', 'verticals: {0}, {1}'], ['inclinação', 'tilt'], ['curvatura', 'curvature'],
  // ── mensagens (barra de estado, confirmações)
  ['Pronto.', 'Ready.'],
  ['Folha encontrada (confiança alta). Enter para aplicar.', 'Sheet found (high confidence). Enter to apply.'],
  ['Confiança média{0}. Confirma os pontos e carrega em Enter.', 'Medium confidence{0}. Check the points and press Enter.'],
  ['Confiança baixa{0}. Ajusta os cantos à mão.', 'Low confidence{0}. Adjust the corners by hand.'],
  ['cantos com ângulos pouco prováveis', 'unlikely corner angles'], ['as margens da folha não parecem lisas', "the sheet's margins do not look smooth"],
  ['parte das margens não parece papel', 'part of the margins does not look like paper'], ['um dos lados quase não tem aresta visível', 'one side has almost no visible edge'],
  ['proporção da folha pouco provável', 'unlikely sheet proportions'], ['pouco texto para confirmar a geometria', 'too little text to confirm the geometry'],
  ['as linhas de texto não ficam bem direitas ({0} mm)', 'the text lines are not quite straight ({0} mm)'],
  ['correção pelas linhas demasiado grande: ignorada', 'correction from the lines too large: ignored'], ['folha não encontrada: arrasta os cantos', 'sheet not found: drag the corners'],
  ['Foto → página: {0}', 'Photo → page: {0}'], ['Foto → página — feito.', 'Photo → page — done.'],
  ['Foto → página: {0} de {1} página(s) endireitada(s).', 'Photo → page: {0} of {1} page(s) straightened.'],
  ['{0} ficaram como estavam (confiança baixa{1}): usa P nessas.', '{0} were left as they were (low confidence{1}): use P on those.'], ['ou erro', 'or error'],
  ['{0} página(s) PDF digital(is) ignorada(s).', '{0} digital PDF page(s) skipped.'],
  ['Nesse intervalo só há páginas PDF digitais (vetoriais): já estão direitas.', 'That range only has digital (vector) PDF pages: they are already straight.'],
  ['Nesse intervalo só há páginas PDF digitais: já têm texto.', 'That range only has digital PDF pages: they already contain text.'],
  ['Em processamento: {0} de {1} ({2} em paralelo)…', 'Processing: {0} of {1} ({2} in parallel)…'],
  ['{0} página(s) adicionada(s).', '{0} page(s) added.'],
  ['Fotos endireitadas: {0} de {1}', 'Photos straightened: {0} of {1}'],
  ['(as restantes ficaram como estavam, por falta de confiança na deteção: usa “Foto → página”, tecla P).', '(the others were left as they were, for lack of confidence in the detection: use “Photo → page”, key P).'],
  ['Para endireitar uma foto e pô-la no tamanho real, usa “Foto → página” (tecla P).', 'To straighten a photo and set it to its real size, use “Photo → page” (key P).'],
  ['Formato não suportado. Usa PDF, PNG, JPEG, HEIC, WEBP, GIF ou BMP.', 'Unsupported format. Use PDF, PNG, JPEG, HEIC, WEBP, GIF or BMP.'],
  ['A abrir ficheiros…', 'Opening files…'], ['A abrir {0}…', 'Opening {0}…'], ['A converter {0} (HEIC)…', 'Converting {0} (HEIC)…'],
  ['Erro a abrir: {0}', 'Error opening: {0}'], ['Erro a mostrar a página: {0}', 'Error showing the page: {0}'],
  ['{0}: página {1} de {2}…', '{0}: page {1} of {2}…'], ['O ficheiro "{0}" tem palavra-passe:', 'The file "{0}" has a password:'],
  ['{0}: {1} — as páginas vão ser exportadas como imagem.', '{0}: {1} — the pages will be exported as images.'], ['PDF protegido', 'protected PDF'], ['estrutura não suportada', 'unsupported structure'],
  ['(nenhum scanner encontrado)', '(no scanner found)'], ['(erro)', '(error)'], ['[não é scanner]', '[not a scanner]'],
  ['O Windows não vê nenhum scanner WIA. Experimenta “Digitalizar com janela do driver”.', 'Windows does not see any WIA scanner. Try “Scan with the driver window”.'],
  ['{0} dispositivo(s) encontrado(s).', '{0} device(s) found.'], ['Erro ao procurar scanners: {0}', 'Error looking for scanners: {0}'],
  ['A abrir a janela do driver…', 'Opening the driver window…'], ['A digitalizar…', 'Scanning…'], ['A receber página {0}…', 'Receiving page {0}…'],
  ['{0} página(s) digitalizada(s){1}. Total: {2}.', '{0} page(s) scanned{1}. Total: {2}.'], ['a {0} ppp', 'at {0} dpi'], ['Aviso: {0}', 'Warning: {0}'],
  ['Erro na digitalização: {0}', 'Scanning error: {0}'],
  ['Esta operação converte a página PDF numa imagem a {0} ppp (o texto deixa de ser selecionável nessa página).\n\nContinuar?', 'This turns the PDF page into an image at {0} dpi (the text on that page will no longer be selectable).\n\nContinue?'],
  ['{0}: página {1} de {2}…', '{0}: page {1} of {2}…'], ['{0} — feito.', '{0} — done.'], ['{0}: erro — {1}', '{0}: error — {1}'],
  ['Desenha primeiro a área a manter.', 'First draw the area to keep.'],
  ['Essa zona é demasiado escura para ser o branco. Clica no papel.', 'That area is too dark to be white. Click on the paper.'],
  ['Essa zona é demasiado clara para ser o preto. Clica no texto.', 'That area is too light to be black. Click on the text.'],
  ['Apagar {0} páginas?', 'Delete {0} pages?'], ['{0} página(s) apagada(s). Ctrl+Z para desfazer.', '{0} page(s) deleted. Ctrl+Z to undo.'],
  ['Começar um documento novo? As páginas atuais saem da lista (podes desfazer com Ctrl+Z).', 'Start a new document? The current pages leave the list (you can undo with Ctrl+Z).'],
  ['Desfeito.', 'Undone.'], ['Refeito.', 'Redone.'], ['A linha já está direita.', 'The line is already straight.'],
  ['Rodar {0}°', 'Rotate {0}°'],
  ['Intervalo inválido: {0}', 'Invalid range: {0}'], ['Não há páginas para exportar.', 'There are no pages to export.'],
  ['Nenhuma página corresponde à escolha em “Páginas”.', 'No page matches the choice in “Pages”.'],
  ['A abrir a janela “Guardar como”…', 'Opening the “Save as” window…'], ['Não foi possível abrir a janela “Guardar como”: {0}', 'Could not open the “Save as” window: {0}'],
  ['Exportação cancelada.', 'Export cancelled.'], ['A exportar…', 'Exporting…'], ['A exportar página {0} de {1}…', 'Exporting page {0} of {1}…'],
  ['PDF: página {0} de {1}…', 'PDF: page {0} of {1}…'], ['TIFF: página {0} de {1}…', 'TIFF: page {0} of {1}…'], ['A gravar o PDF…', 'Saving the PDF…'],
  ['Exportado: {0} — mostrar na pasta', 'Exported: {0} — show in folder'], ['Exportado: {0}', 'Exported: {0}'], ['mostrar na pasta', 'show in folder'],
  ['{0} ficheiros em {1}', '{0} files in {1}'], ['Erro ao exportar: {0}', 'Export error: {0}'],
  ['Documento PDF', 'PDF document'], ['Imagem PNG', 'PNG image'], ['Imagem JPEG', 'JPEG image'], ['Imagem TIFF', 'TIFF image'], ['Imagem SVG', 'SVG image'],
  ['Falha a codificar a imagem (demasiado grande?)', 'Could not encode the image (too large?)'], ['Não foi possível carregar {0}', 'Could not load {0}'],
  ['o ficheiro HEIC não tem imagens', 'the HEIC file has no images'], ['falha a descodificar o HEIC', 'could not decode the HEIC file'], ['falha no processamento da foto', 'photo processing failed'],
  ['A instalar o SANE… (confirma a palavra-passe na janela do sistema)', 'Installing SANE… (confirm the password in the system window)'], ['Instalação: {0}', 'Installation: {0}'],
  ['Texto lido em {0} página(s), {1} palavras.', 'Text read on {0} page(s), {1} words.'], ['Língua detetada: {0}.', 'Language detected: {0}.'], ['Línguas: {0}.', 'Languages: {0}.'],
  ['{0} página(s) PDF digital(is) já tinham texto.', '{0} digital PDF page(s) already had text.'], ['Vê no separador Texto.', 'See the Text tab.'],
  ['Ler texto: {0}', 'Read text: {0}'], ['Texto copiado.', 'Text copied.'], ['Texto gravado: {0}', 'Text saved: {0}'], ['Gravar texto: {0}', 'Save text: {0}'],
  ['Ainda não há páginas lidas. Usa “Ler texto”.', 'No pages have been read yet. Use “Read text”.'],
  ['Servidor de teste: não há scanner. Adiciona imagens ou PDFs.', 'Test server: there is no scanner. Add images or PDFs.'],
];

export let lang = 'pt';
const exact = new Map(), patterns = [];
const esc = (s) => s.replace(/[.*+?^$()|[\]\\]/g, '\\$&');
for (const [pt, en] of PAIRS) {
  if (/\{\d\}/.test(pt)) patterns.push({ re: new RegExp('^' + esc(pt).replace(/\{(\d)\}/g, '(.+?)') + '$', 's'), en });
  else exact.set(pt, en);
}
patterns.sort((a, b) => b.re.source.length - a.re.source.length); // os modelos mais específicos primeiro

function trCore(s, depth = 0) {
  if (exact.has(s)) return exact.get(s);
  if (depth > 4) return s;
  for (const p of patterns) {
    const m = s.match(p.re);
    if (m) return p.en.replace(/\{(\d)\}/g, (_, i) => trCore(m[+i + 1], depth + 1));
  }
  if (s.startsWith(': ')) return ': ' + trCore(s.slice(2), depth + 1);
  // frases, partes separadas por " · " ou "; "
  for (const sep of [/\n/, /(?<=[.!?…])\s+(?=[A-ZÀ-Ú(“"0-9])/, /\s·\s/, /;\s/]) {
    const parts = s.split(sep);
    if (parts.length > 1) {
      const joiner = sep.source === '\\n' ? '\n' : sep.source.includes('·') ? ' · ' : sep.source.startsWith(';') ? '; ' : ' ';
      return parts.map((x) => trCore(x, depth + 1)).join(joiner);
    }
  }
  if (s.startsWith('· ')) return '· ' + trCore(s.slice(2), depth + 1);
  return s;
}
// Traduz um texto para a língua atual (em PT devolve-o igual), mantendo os espaços à volta
export function tr(s) {
  if (lang === 'pt' || !s) return s;
  const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(s);
  return m[2] ? m[1] + trCore(m[2]) + m[3] : s;
}

// ── tradução da página: textos e atributos title/placeholder (guarda o original em PT para poder voltar)
const ATTRS = ['title', 'placeholder'];
const skip = (el) => el && el.closest && el.closest('script, style, textarea, .notr');
function trText(n) {
  if (n.__shown === n.nodeValue) return; // já tratado (evita ciclos com o observador)
  if (!n.nodeValue.trim() || skip(n.parentElement)) return;
  n.__pt = n.nodeValue;
  n.__shown = tr(n.__pt);
  if (n.__shown !== n.nodeValue) n.nodeValue = n.__shown;
}
function trAttrs(el) {
  if (skip(el)) return;
  el.__pt = el.__pt || {}; el.__shownA = el.__shownA || {};
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v == null || v === el.__shownA[a]) continue;
    el.__pt[a] = v;
    el.__shownA[a] = tr(v);
    if (el.__shownA[a] !== v) el.setAttribute(a, el.__shownA[a]);
  }
}
function walk(root) {
  if (root.nodeType === 3) { trText(root); return; }
  if (root.nodeType !== 1) return;
  trAttrs(root);
  const it = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) n.nodeType === 3 ? trText(n) : trAttrs(n);
}
let observer = null;
export function startTranslation() {
  walk(document.body);
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') trText(m.target);
      else if (m.type === 'attributes') trAttrs(m.target);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}
// Muda a língua e volta a traduzir tudo a partir dos originais em PT
export function setLang(l) {
  lang = l === 'en' ? 'en' : 'pt';
  document.documentElement.lang = lang === 'en' ? 'en' : 'pt-PT';
  const it = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  for (let n = it.nextNode(); n; n = it.nextNode()) {
    if (n.nodeType === 3) { if (n.__pt != null) { n.__shown = tr(n.__pt); n.nodeValue = n.__shown; } else trText(n); }
    else if (n.__pt) { for (const a of ATTRS) if (n.__pt[a] != null) { n.__shownA[a] = tr(n.__pt[a]); n.setAttribute(a, n.__shownA[a]); } }
    else trAttrs(n);
  }
}
