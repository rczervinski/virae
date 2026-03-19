# Viraê — Instruções para Claude Code

## Visão geral do projeto

Estamos construindo o **Viraê**, um site all-in-one de ferramentas online para manipulação de arquivos (PDF, imagem, GIF, áudio, vídeo, conversão universal e IA). Monetização via Google AdSense (free tier) e assinatura PRO R$9,90/mês (sem ads + limites maiores).

---

## Stack técnica

- **Runtime**: Node.js 20+ com Express
- **Frontend**: HTML estático com CSS vanilla (sem framework React/Vue) + SVGs inline para ícones e ilustrações
- **Processamento**:
  - PDF: `pdf-lib`, `ghostscript`, `libreoffice` (headless)
  - Imagem: `sharp`, `imagemagick`
  - GIF: `gifsicle`, `imagemagick`
  - Áudio: `ffmpeg`
  - Vídeo: `ffmpeg`
  - IA: API OpenAI `gpt-4o-mini`
- **Storage**: `/tmp/virae-sessions/` com cron job limpando arquivos > 1 hora
- **Pagamento**: MercadoPago API (BR) ou Stripe
- **Ads**: Google AdSense
- **Deploy**: VPS (Ubuntu 22+) com Nginx reverse proxy + PM2

---

## Estrutura de pastas

```
virae/
├── package.json
├── server.js                    # Express entry point
├── .env.example
├── ecosystem.config.js          # PM2 config
├── nginx.conf                   # Nginx template
│
├── config/
│   ├── tools.json               # Registry de todas as 80+ ferramentas
│   └── ads.js                   # Config AdSense slots
│
├── public/
│   ├── css/
│   │   ├── global.css           # Design system: variáveis, tipografia, grid
│   │   ├── landing.css          # Estilo das landing pages de ferramentas
│   │   └── components.css       # Upload area, progress bar, resultado
│   ├── js/
│   │   ├── upload.js            # Drag & drop, validação, progress
│   │   ├── tools.js             # Lógica de cada ferramenta (client-side)
│   │   └── ads.js               # Carrega AdSense condicionalmente (free users)
│   └── svg/                     # SVGs de ícones (1 por ferramenta)
│       ├── merge-pdf.svg
│       ├── compress-image.svg
│       └── ... (80+ SVGs)
│
├── views/
│   ├── layouts/
│   │   └── base.ejs             # Layout base com head, nav, footer, ads slots
│   ├── partials/
│   │   ├── nav.ejs
│   │   ├── footer.ejs
│   │   ├── upload-area.ejs      # Componente reutilizável de upload
│   │   ├── ad-slot.ejs          # Componente de anúncio (hidden se PRO)
│   │   └── tool-result.ejs      # Área de resultado/download
│   ├── index.ejs                # Homepage com grid de todas as ferramentas
│   └── tool.ejs                 # Template ÚNICO de landing page por ferramenta
│
├── routes/
│   ├── index.js                 # Homepage
│   ├── tool.js                  # GET /:slug → renderiza landing da ferramenta
│   ├── api/
│   │   ├── process.js           # POST /api/process/:slug → processa arquivo
│   │   ├── upload.js            # POST /api/upload → recebe arquivo
│   │   └── ai.js                # POST /api/ai/:action → endpoints IA
│   └── auth/
│       ├── login.js
│       └── subscribe.js         # MercadoPago webhook
│
├── services/
│   ├── pdf.service.js           # Todas as operações PDF
│   ├── image.service.js         # Todas as operações de imagem
│   ├── gif.service.js           # Todas as operações GIF
│   ├── audio.service.js         # Todas as operações de áudio
│   ├── video.service.js         # Todas as operações de vídeo
│   ├── convert.service.js       # Conversões universais
│   ├── ai.service.js            # Wrapper OpenAI API
│   └── cleanup.service.js       # Cron job de limpeza /tmp
│
├── middleware/
│   ├── upload.js                # Multer config + validação de tipo/tamanho
│   ├── rateLimit.js             # Rate limiting por IP (free) / por user (PRO)
│   ├── session.js               # Express session para tracking
│   └── isPro.js                 # Middleware que verifica se user é PRO
│
└── scripts/
    ├── generate-svgs.js         # Gera SVGs de ícones para cada ferramenta
    └── seed-tools.js            # Popula tools.json
```

---

## Landing page por ferramenta — A PARTE MAIS IMPORTANTE PARA SEO

### Conceito

Cada ferramenta tem sua própria URL: `/comprimir-pdf`, `/converter-mp3-para-wav`, `/gif-maker`, etc.

Cada landing é renderizada pelo mesmo template `tool.ejs`, mas recebe dados diferentes do `tools.json`.

### Estrutura de cada landing page

```
┌─────────────────────────────────────────┐
│  NAV (logo + links categorias + PRO)    │
├─────────────────────────────────────────┤
│                                         │
│  [SVG ícone da ferramenta]              │
│                                         │
│  <h1>Comprimir PDF Online Grátis</h1>   │
│  <p>Descrição SEO-friendly 2 linhas</p> │
│                                         │
│  ┌─────────────────────────────────┐    │
│  │  UPLOAD AREA (drag & drop)      │    │
│  │  "Arraste seu PDF aqui"         │    │
│  │  ou clique para selecionar      │    │
│  │  Limite: 50MB free / 500MB PRO  │    │
│  └─────────────────────────────────┘    │
│                                         │
│  [Opções da ferramenta se houver]       │
│  Ex: nível de compressão, formato       │
│                                         │
│  [BOTÃO PROCESSAR]                      │
│                                         │
├─────────────────────────────────────────┤
│  📢 AD SLOT — Google AdSense 728x90    │
│  (hidden se user PRO)                   │
├─────────────────────────────────────────┤
│                                         │
│  <h2>Como comprimir PDF?</h2>           │
│  Passo 1, 2, 3 com SVG ilustrações     │
│                                         │
│  <h2>Por que comprimir PDF?</h2>        │
│  Texto SEO explicativo                  │
│                                         │
│  <h2>Perguntas frequentes</h2>          │
│  Accordion FAQ com schema markup        │
│                                         │
├─────────────────────────────────────────┤
│  📢 AD SLOT — Google AdSense 336x280   │
├─────────────────────────────────────────┤
│                                         │
│  <h2>Ferramentas relacionadas</h2>      │
│  Grid com 4-6 tools da mesma categoria  │
│                                         │
├─────────────────────────────────────────┤
│  FOOTER                                 │
└─────────────────────────────────────────┘
```

### Registry de ferramentas (`tools.json`)

Cada ferramenta tem esta estrutura:

```json
{
  "slug": "comprimir-pdf",
  "name": "Comprimir PDF",
  "category": "pdf",
  "title": "Comprimir PDF Online Grátis — Reduza o Tamanho do Seu PDF",
  "metaDescription": "Comprima arquivos PDF online gratuitamente. Reduza o tamanho do PDF sem perder qualidade. Sem instalação, sem cadastro.",
  "h1": "Comprimir PDF Online Grátis",
  "description": "Reduza o tamanho do seu arquivo PDF mantendo a qualidade. Upload, comprima e baixe em segundos.",
  "acceptedFormats": [".pdf"],
  "maxSizeFree": 52428800,
  "maxSizePro": 524288000,
  "icon": "compress-pdf",
  "color": "#ff6b6b",
  "options": [
    {
      "name": "quality",
      "type": "select",
      "label": "Nível de compressão",
      "values": ["low", "medium", "high"],
      "default": "medium"
    }
  ],
  "steps": [
    "Faça upload do seu PDF",
    "Escolha o nível de compressão",
    "Clique em Comprimir e baixe o resultado"
  ],
  "faq": [
    {
      "q": "O PDF perde qualidade ao comprimir?",
      "a": "No nível médio, a diferença visual é imperceptível. Para documentos com muitas imagens, o nível alto pode reduzir um pouco a nitidez."
    },
    {
      "q": "Qual o tamanho máximo?",
      "a": "50MB no plano gratuito e 500MB no plano PRO."
    }
  ],
  "relatedTools": ["merge-pdf", "split-pdf", "pdf-para-word"],
  "processorService": "pdf",
  "processorMethod": "compress",
  "isPro": false,
  "isAI": false
}
```

---

## SVGs — Ícones e ilustrações

### Filosofia

TODOS os ícones e ilustrações visuais do site são SVGs inline. Nenhuma imagem raster (PNG/JPG) para UI. Motivos:
- Carrega instantaneamente (inline no HTML)
- Escala perfeita em qualquer tela
- Customizável via CSS (cores mudam com tema)
- Peso zero de HTTP requests extras

### Padrão de ícone SVG (cada ferramenta)

Cada ícone é um SVG 48x48 com traço fino, estilo consistente:

```svg
<!-- Exemplo: ícone de comprimir PDF -->
<svg viewBox="0 0 48 48" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="4" width="24" height="32" rx="3" stroke="currentColor" stroke-width="1.5"/>
  <path d="M16 40h16a3 3 0 003-3V14l-10-10H16" stroke="currentColor" stroke-width="1.5"/>
  <path d="M22 4v10h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <path d="M18 24l6 6 6-6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  <path d="M24 18v12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
</svg>
```

### Regras para SVGs:
1. `viewBox="0 0 48 48"` padronizado
2. `fill="none"` + `stroke="currentColor"` (herda cor do CSS)
3. `stroke-width="1.5"` padrão
4. `stroke-linecap="round"` e `stroke-linejoin="round"`
5. Máximo 6-8 paths por ícone (simplicidade)
6. Nome do arquivo = slug da ferramenta: `compress-pdf.svg`

### SVGs de ilustração (steps how-to)

Para a seção "Como usar" de cada landing, use SVGs maiores (200x160) mostrando cada passo:

```svg
<!-- Step 1: Upload -->
<svg viewBox="0 0 200 160" fill="none">
  <rect x="40" y="20" width="120" height="100" rx="12"
    stroke="currentColor" stroke-width="1" stroke-dasharray="6 4"/>
  <path d="M100 50v30M88 62l12-12 12 12"
    stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  <text x="100" y="105" text-anchor="middle"
    fill="currentColor" font-size="11" font-family="inherit">
    Arraste o arquivo
  </text>
</svg>
```

---

## Slots de anúncios

### Posições no layout

```
POSIÇÃO 1: Após upload area (antes dos resultados)
  → Formato: Leaderboard 728x90
  → ID: ad-slot-top

POSIÇÃO 2: Após seção "Como usar"
  → Formato: Large Rectangle 336x280
  → ID: ad-slot-middle

POSIÇÃO 3: Antes do footer
  → Formato: Leaderboard 728x90
  → ID: ad-slot-bottom

POSIÇÃO 4 (mobile only): Entre ferramentas relacionadas
  → Formato: Mobile Banner 320x100
  → ID: ad-slot-mobile
```

### Implementação

```html
<!-- ad-slot.ejs -->
<% if (!user || !user.isPro) { %>
<div class="ad-container" id="<%= slotId %>">
  <div class="ad-label">Publicidade</div>
  <ins class="adsbygoogle"
    style="display:block"
    data-ad-client="ca-pub-XXXXXXXXXX"
    data-ad-slot="<%= adSlotId %>"
    data-ad-format="auto"
    data-full-width-responsive="true">
  </ins>
  <script>(adsbygoogle = window.adsbygoogle || []).push({});</script>
</div>
<% } %>
```

### CSS dos ad slots

```css
.ad-container {
  position: relative;
  text-align: center;
  margin: 2rem auto;
  padding: 1rem;
  max-width: 728px;
  min-height: 90px;
  background: var(--bg-secondary);
  border: 1px dashed var(--border);
  border-radius: 8px;
}
.ad-label {
  position: absolute;
  top: 4px;
  right: 8px;
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-muted);
}
```

---

## Design system (CSS vars)

```css
:root {
  --bg: #0a0a0f;
  --bg2: #13131a;
  --bg3: #1a1a24;
  --card: #16161f;
  --text: #e8e6e3;
  --text2: #9b99a1;
  --text3: #6b6976;
  --accent: #6c5ce7;
  --accent2: #a29bfe;
  --teal: #00cec9;
  --coral: #ff6b6b;
  --amber: #fdcb6e;
  --green: #55efc4;
  --pink: #fd79a8;
  --blue: #74b9ff;
  --radius: 14px;
  --radius-sm: 8px;
  --font: 'DM Sans', system-ui, sans-serif;
  --font-mono: 'Space Mono', monospace;
}
```

---

## Prioridade de implementação

### Fase 1 — MVP (semana 1-2)
1. Setup Express + EJS + estrutura de pastas
2. Template `tool.ejs` + `tools.json` com 5 ferramentas:
   - Comprimir PDF
   - Merge PDF
   - Comprimir imagem
   - Converter imagem (JPG↔PNG↔WebP)
   - Resize imagem
3. Upload area funcional com multer
4. Processamento real via sharp (imagem) e ghostscript (PDF)
5. Homepage com grid de ferramentas
6. Cleanup cron job
7. Ad slots configurados

### Fase 2 — Expansão (semana 3-4)
8. +15 ferramentas PDF
9. +12 ferramentas GIF (gifsicle + ffmpeg)
10. +12 ferramentas áudio (ffmpeg)
11. Rate limiting

### Fase 3 — PRO + IA (semana 5-6)
12. Auth + sessões (login simples por email)
13. MercadoPago integração
14. Middleware isPro
15. GPT-4o-mini endpoints (resumir, traduzir, OCR)
16. Ferramentas de vídeo (ffmpeg)

### Fase 4 — SEO + Polish (semana 7-8)
17. Schema markup JSON-LD em cada landing
18. Sitemap.xml dinâmico
19. robots.txt
20. Open Graph + Twitter Cards
21. Performance tuning (lazy load, cache headers)

---

## Comandos úteis

```bash
# Instalar dependências do sistema
sudo apt install ghostscript imagemagick gifsicle ffmpeg

# Instalar Node deps
npm install express ejs multer sharp pdf-lib node-cron uuid dotenv

# Rodar em dev
node server.js

# PM2 produção
pm2 start ecosystem.config.js
```

---

## WORKFLOW DE CONSTRUÇÃO — Ordem exata de execução

### O que você recebeu

Junto com este documento, você receberá:

1. **HTML/CSS exportado do Google Stitch** → Uma landing page de UMA ferramenta (ex: "Comprimir PDF"). Este é o DESIGN DE REFERÊNCIA. Todo o visual do site deve seguir este padrão.
2. **tools-registry.json** → Registro de todas as 80+ ferramentas com slugs, categorias, FAQs, steps, formatos aceitos, etc.
3. **Este documento** (claude-code-prompt.md) → Arquitetura, stack, estrutura de pastas, regras.

### Passo 1 — Analisar o HTML do Stitch

Antes de escrever qualquer código:
- Abra o HTML do Stitch e extraia o design system: cores, fontes, espaçamentos, border-radius, sombras, hover states
- Identifique os componentes: nav, hero, upload area, options row, ad slot, how-it-works cards, benefit cards, FAQ accordion, related tools grid, footer
- Crie variáveis CSS baseadas no que o Stitch usou (não invente — copie os valores dele)
- O Stitch gera design de QUALIDADE. Respeite as escolhas dele de tipografia, spacing e hierarchy

### Passo 2 — Criar o template EJS da ferramenta individual (`tool.ejs`)

Este é o CORE do projeto. Um único template EJS que renderiza QUALQUER ferramenta baseado nos dados do `tools.json`.

O template deve:
- Replicar EXATAMENTE o layout e estilo visual do HTML do Stitch
- Trocar o conteúdo estático por variáveis EJS: `<%= tool.h1 %>`, `<%= tool.description %>`, etc.
- Renderizar opções dinamicamente baseado em `tool.options[]`
- Renderizar steps, FAQ e related tools dinamicamente
- Incluir os ad slots condicionais (hidden se PRO)
- Incluir schema markup JSON-LD dinâmico para SEO
- O CSS deve estar em arquivo externo (`landing.css`), não inline

Seções dinâmicas do template:
```ejs
<%# HERO %>
<h1><%= tool.h1 %></h1>
<p><%= tool.description %></p>

<%# UPLOAD AREA %>
<div class="upload-area" data-accept="<%= tool.acceptedFormats.join(',') %>">
  Arraste seu <%= tool.category === 'pdf' ? 'PDF' : 'arquivo' %> aqui
</div>

<%# OPTIONS (renderiza só se tool.options existe) %>
<% if (tool.options && tool.options.length > 0) { %>
  <div class="options-row">
    <% tool.options.forEach(opt => { %>
      <%# renderiza select, range, checkbox baseado em opt.type %>
    <% }) %>
  </div>
<% } %>

<%# AD SLOT 1 %>
<%- include('partials/ad-slot', { slotId: 'ad-top', adSlotId: 'XXXXXX' }) %>

<%# HOW IT WORKS %>
<% tool.steps.forEach((step, i) => { %>
  <div class="step-card">
    <span class="step-num"><%= i + 1 %></span>
    <p><%= step %></p>
  </div>
<% }) %>

<%# FAQ com schema markup %>
<% if (tool.faq && tool.faq.length > 0) { %>
  <% tool.faq.forEach(item => { %>
    <details class="faq-item">
      <summary><%= item.q %></summary>
      <p><%= item.a %></p>
    </details>
  <% }) %>
<% } %>

<%# RELATED TOOLS %>
<% const related = allTools.filter(t => tool.relatedTools?.includes(t.slug)) %>
<% related.forEach(r => { %>
  <a href="/<%= r.slug %>" class="related-card">
    <span class="related-icon cat-<%= r.category %>">...</span>
    <span><%= r.name %></span>
  </a>
<% }) %>
```

### Passo 3 — Rota dinâmica

```javascript
// routes/tool.js
const tools = require('../config/tools.json').tools;

router.get('/:slug', (req, res) => {
  const tool = tools.find(t => t.slug === req.params.slug);
  if (!tool) return res.status(404).render('404');
  
  const allTools = tools; // para related tools
  res.render('tool', { tool, allTools, user: req.session?.user });
});
```

Com isso, TODAS as 80+ ferramentas já funcionam automaticamente:
- `/comprimir-pdf` → renderiza tool.ejs com dados de "comprimir-pdf"
- `/gif-maker` → renderiza tool.ejs com dados de "gif-maker"
- `/converter-audio` → renderiza tool.ejs com dados de "converter-audio"

### Passo 4 — Homepage global (`index.ejs`)

DEPOIS que o template individual estiver pronto, criar a homepage.

A homepage deve:
- Usar o MESMO design system / CSS do Stitch (mesmas cores, fontes, cards, spacing)
- Ter hero com search bar
- Mostrar TODAS as ferramentas agrupadas por categoria
- Cada ferramenta é um card clicável que leva à landing individual
- Incluir ad slots entre categorias
- Ter a mesma nav e footer das landing pages individuais

Layout da homepage:
```
┌──────────────────────────────────────────────┐
│  NAV (mesmo das landings)                    │
├──────────────────────────────────────────────┤
│                                              │
│  HERO                                        │
│  "Todas as ferramentas. Um só lugar."        │
│  [Search bar]                                │
│  Stats: 80+ tools | 0 instalação | 1h auto   │
│                                              │
│  [Upload area universal]                     │
│  "Arraste qualquer arquivo"                  │
│                                              │
├──────────────────────────────────────────────┤
│  📢 AD SLOT                                 │
├──────────────────────────────────────────────┤
│                                              │
│  📄 FERRAMENTAS PDF                          │
│  [grid de cards: merge, split, compress...]  │
│                                              │
│  🖼 FERRAMENTAS DE IMAGEM                    │
│  [grid de cards: resize, crop, compress...]  │
│                                              │
│  📢 AD SLOT                                 │
│                                              │
│  🎞 FERRAMENTAS GIF                          │
│  [grid de cards: gif maker, video→gif...]    │
│                                              │
│  🎵 FERRAMENTAS DE ÁUDIO                     │
│  [grid de cards: converter, cortar...]       │
│                                              │
│  📢 AD SLOT                                 │
│                                              │
│  🎬 FERRAMENTAS DE VÍDEO                     │
│  [grid de cards: converter, comprimir...]    │
│                                              │
│  🔄 CONVERSÃO UNIVERSAL                      │
│  [grid de cards: docx→pdf, csv→xlsx...]      │
│                                              │
│  🤖 FERRAMENTAS IA                           │
│  [grid de cards: resumir, traduzir, OCR...]  │
│                                              │
├──────────────────────────────────────────────┤
│  PRICING SECTION                             │
│  Grátis vs PRO R$9,90/mês                   │
├──────────────────────────────────────────────┤
│  FOOTER                                      │
└──────────────────────────────────────────────┘
```

A homepage renderiza os cards dinamicamente do mesmo `tools.json`:
```javascript
// routes/index.js
const { tools, categories } = require('../config/tools.json');

router.get('/', (req, res) => {
  const grouped = {};
  categories.forEach(cat => {
    grouped[cat.id] = {
      ...cat,
      tools: tools.filter(t => t.category === cat.id)
    };
  });
  res.render('index', { grouped, user: req.session?.user });
});
```

### Passo 5 — Backend de processamento (services)

Só DEPOIS dos passos 1-4 (frontend completo), implementar os services reais.

### Resumo da ordem

```
1. Extrair design system do HTML do Stitch
2. Criar global.css + landing.css com as variáveis extraídas
3. Criar tool.ejs (template único, replica o visual do Stitch)
4. Criar rota /:slug que renderiza tool.ejs com dados do tools.json
5. Testar com 3-5 ferramentas (verificar que /comprimir-pdf, /gif-maker, etc. funcionam)
6. Criar index.ejs (homepage) usando o MESMO design system
7. Criar upload.js (drag & drop funcional)
8. Implementar services de processamento (fase 2)
9. Implementar auth + PRO (fase 3)
10. SEO final: sitemaps, schema, OG tags (fase 4)
```

### REGRA DE OURO

O HTML do Stitch é a fonte da verdade visual. Se em dúvida sobre qualquer decisão de design (cor, espaçamento, tamanho de fonte, border-radius, hover effect), CONSULTE o HTML do Stitch. Não invente. O Stitch já fez o trabalho de design — o Claude Code faz o trabalho de engenharia.