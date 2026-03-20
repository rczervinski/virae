# Virae — Contexto para Continuidade de Sessao

> Use este arquivo como contexto ao iniciar uma nova sessao com a IA.
> Cole o conteudo inteiro no inicio da conversa para retomar o trabalho.

---

## O Que e o Virae

Aplicacao web de ferramentas online (PDF, imagem, audio, video, GIF, conversao, IA). Stack:

- **Frontend:** Express.js + EJS + CSS puro (sem framework CSS)
- **Backend:** Node.js, Express, Multer, Sharp, pdf-lib, pdfjs-dist
- **IA:** Anthropic SDK (@anthropic-ai/sdk)
- **PDF Engine:** Stirling PDF v0.46.2 (MIT) rodando em Docker, white-labeled como "Virae PDF"
- **Fonte:** Manrope (headlines/body) + Space Grotesk (labels)
- **Icones:** Material Symbols Outlined (Google)

---

## Estrutura de Pastas

```
virae/
├── server.js                  # Express server principal (porta 3000)
├── docker-compose.yml         # Docker do PDF engine
├── package.json               # Deps: express, multer, sharp, pdf-lib, etc.
├── config/
│   └── tools.json             # 131 ferramentas (66 PDF, 12 img, 11 GIF, 12 audio, 12 video, 10 convert, 8 IA)
├── views/
│   ├── index.ejs              # Landing page (hero + categorias + pricing)
│   ├── tool.ejs               # Pagina individual de ferramenta
│   ├── 404.ejs
│   ├── layouts/base.ejs
│   └── partials/              # nav, footer, ad-slot, upload-area, tool-result
├── public/
│   ├── css/
│   │   ├── global.css         # Design tokens, reset, nav, footer
│   │   ├── landing.css        # Estilos de index.ejs, tool.ejs, 404, engine CTA, mouse glow, shimmer
│   │   ├── components.css     # Componentes reutilizaveis
│   │   └── pdf-editor.css     # Editor PDF inline
│   └── js/
│       ├── upload.js          # Upload de arquivos
│       ├── tools.js           # Logica de ferramentas
│       └── pdf-editor.js      # Editor PDF client-side
├── routes/
│   ├── index.js, tool.js
│   ├── api/process.js         # Endpoints de processamento
│   └── auth/login.js, subscribe.js
├── services/
│   ├── pdf.service.js, image.service.js, audio.service.js
│   ├── video.service.js, gif.service.js, convert.service.js
│   ├── ai.service.js          # Ferramentas IA (Claude)
│   └── cleanup.service.js     # Cron de limpeza de arquivos temp
├── middleware/
│   ├── session.js, upload.js, isPro.js, rateLimit.js
└── engine/pdf/                # Stirling PDF v0.46.2 source code (white-labeled)
    ├── Dockerfile.fat         # Build do container
    ├── src/main/java/...      # Spring Boot + Thymeleaf
    └── src/main/resources/    # Templates, CSS, JS, favicon
```

---

## Design System (CSS Variables)

```css
--color-background:           #131318   /* fundo escuro */
--color-surface-container:    #1f1f25   /* cards */
--color-primary:              #c6bfff   /* roxo claro (texto) */
--color-primary-container:    #6c5ce7   /* roxo forte (botoes) */
--color-secondary:            #46eae5   /* cyan */
--color-secondary-container:  #00cec9   /* cyan escuro */
--color-tertiary:             #ffb3b0   /* rosa/salmao */
--color-on-surface:           #e4e1e9   /* texto principal */
--color-on-surface-variant:   #c8c4d7   /* texto secundario */
--color-outline-variant:      #474554   /* bordas */
```

---

## PDF Engine (Stirling PDF White-Label)

### Como funciona
- Container Docker buildado do source em `engine/pdf/Dockerfile.fat`
- Roda na porta 8080 internamente
- Express faz reverse proxy em `/engine/pdf` -> `http://localhost:8080`
- `SYSTEM_ROOTURIPATH=/engine/pdf` (deve casar com a rota do proxy)

### O que ja foi customizado
- **Branding:** "Stirling PDF" -> "Virae PDF" em todos os lugares (AppConfig.java, templates, meta tags)
- **Favicon:** SVG com gradiente roxo->cyan e letra "V"
- **Temas:** theme.dark.css e theme.light.css reescritos com paleta Virae
- **Analytics removidos:** PostHog, pixel tracking, GitHub version check
- **Links removidos:** GitHub, Discord, Docker Hub, "Go Pro" do Stirling
- **Erros:** Templates de erro limpos (sem links Stirling)

### Arquivos chave do engine
- `engine/pdf/src/main/java/stirling/software/SPDF/config/AppConfig.java` — defaults "Virae PDF"
- `engine/pdf/src/main/resources/templates/fragments/common.html` — meta tags, analytics removidos
- `engine/pdf/src/main/resources/templates/fragments/navbar.html` — links externos removidos
- `engine/pdf/src/main/resources/templates/fragments/footer.html` — "Powered by Virae"
- `engine/pdf/src/main/resources/static/css/theme/theme.dark.css` — cores Virae
- `engine/pdf/src/main/resources/static/css/theme/theme.light.css` — cores Virae light
- `engine/pdf/src/main/resources/static/favicon.svg` — logo Virae
- `engine/pdf/src/main/resources/static/js/githubVersion.js` — version check desabilitado

---

## Landing Page (index.ejs)

### Estrutura
1. **Mouse Glow** — div fixa com 2 brilhos radiais que seguem o cursor
2. **Nav** — partial com logo, "Assine PRO", menu hamburger
3. **Hero** — h1 com shimmer animation, subtitle, search bar, stats
4. **Categorias** — loop por categories/grouped
   - PDF (66 tools) tem subcategorias: Organizar, Converter para PDF, Converter de PDF, Assinatura & Seguranca, Visualizar & Editar, Avancado
   - Cada subcategoria tem header com icone Material Symbols
   - Outras categorias renderizam grid plano
5. **Ad slots** — inseridos apos categorias 2 e 5
6. **Pricing** — Gratis vs PRO com CTA "Assinar PRO"
7. **Footer**

### Efeitos Visuais Implementados
- **Mouse-following glow:** brilho roxo/cyan que segue o cursor pela pagina (CSS + JS mousemove)
- **Per-card glow:** cada tool-card tem ::before com radial-gradient que segue o mouse dentro do card
- **Shimmer nos titulos:** animacao CSS `shimmer-sweep` passa brilho roxo/cyan da esquerda pra direita em todos os titulos (h1, category, subcategory, section)
- **Stagger delays:** cada categoria tem delay diferente pro shimmer nao sincronizar

---

## Tool Page (tool.ejs)

### Para ferramentas com stirlingRoute (PDF engine)
- Mostra CTA card com botao "Abrir Editor de PDF" que abre `/engine/pdf{stirlingRoute}` em nova aba
- NAO usa iframe

### Para ferramentas nativas (imagem, audio, etc.)
- Upload area com drag & drop
- Opcoes da ferramenta (select, checkbox, range, color, etc.)
- Botao "Processar" que envia para `/api/process`
- Resultado com download

---

## tools.json — Estrutura de Cada Tool

```json
{
  "slug": "comprimir-pdf",
  "name": "Comprimir PDF",
  "category": "pdf",
  "subcategory": "Avancado",
  "icon": "compress",
  "stirlingRoute": "/compress-pdf",
  "title": "Comprimir PDF Online...",
  "metaDescription": "...",
  "h1": "Comprimir PDF",
  "description": "Reduza o tamanho...",
  "acceptedFormats": ".pdf",
  "processorService": "pdf",
  "processorMethod": "compress",
  "isPro": false,
  "isAI": false,
  "options": [...],
  "steps": [...],
  "faq": [...],
  "relatedTools": [...]
}
```

---

## Docker Compose

```yaml
services:
  virae-pdf:
    build:
      context: ./engine/pdf
      dockerfile: Dockerfile.fat
    container_name: virae-pdf-engine
    ports:
      - '8080:8080'
    environment:
      - LANGS=pt_BR
      - DOCKER_ENABLE_SECURITY=false
      - SECURITY_ENABLELOGIN=false
      - UI_APPNAME=Virae PDF
      - UI_APPNAMENAVBAR=Virae PDF
      - UI_HOMEDESCRIPTION=Editor de PDF completo do Virae
      - SYSTEM_DEFAULTLOCALE=pt-BR
      - SYSTEM_ROOTURIPATH=/engine/pdf
      - SYSTEM_ENABLEANALYTICS=false
      - DISABLE_PIXEL=true
    volumes:
      - virae-pdf-data:/configs
    restart: unless-stopped
```

---

## Proxy no server.js

```javascript
const STIRLING_URL = process.env.STIRLING_PDF_URL || 'http://localhost:8080';
app.use('/engine/pdf', createProxyMiddleware({
  target: STIRLING_URL,
  changeOrigin: true,
  pathRewrite: (path) => '/engine/pdf' + path,
  on: {
    proxyRes: (proxyRes) => {
      delete proxyRes.headers['x-frame-options'];
      delete proxyRes.headers['content-security-policy'];
    }
  }
}));
```

---

## Problemas Ja Resolvidos (nao repetir)

1. **Porta 8080 ocupada** — container antigo `virae-stirling-pdf` rodando. Solucao: `docker stop` + `docker rm`
2. **404 em rotas do engine** — stirlingRoutes erradas no tools.json (ex: `/merge` em vez de `/merge-pdfs`). Solucao: leitura dos @GetMapping dos controllers Spring Boot
3. **CSS nao carregando no engine** — SYSTEM_ROOTURIPATH nao casava com rota do proxy. Solucao: ambos devem ser `/engine/pdf`
4. **pathRewrite errado** — precisa ser `'/engine/pdf' + path`, nao strip do prefixo

---

## Git Status Atual

- **Branch:** main
- **Commits:** 3 (first commit, virae, novo pdf)
- **Modificados:** launch.json, tools.json, docker-compose.yml, landing.css, server.js, index.ejs, tool.ejs
- **Untracked:** engine/ (diretorio inteiro do Stirling PDF source)
- **Nada commitado** das mudancas recentes

---

## Proximos Passos / Pendencias

### Prioridade Alta
- [ ] Sistema de sessoes (1h expiry, isolamento por usuario, arquivos temporarios)
- [ ] PRO gating — bloquear ferramentas premium, checar isPro no middleware
- [ ] Commit e push de todas as mudancas (incluindo engine/)

### Prioridade Media
- [ ] Testar TODAS as 66 rotas do PDF engine apos `docker compose up`
- [ ] Responsividade mobile — testar landing e tool pages em telas pequenas
- [ ] SEO — sitemap.xml, robots.txt, structured data por ferramenta
- [ ] Rate limiting por IP nas rotas de API

### Prioridade Baixa
- [ ] Mais efeitos visuais (hover states, scroll animations)
- [ ] PWA / Service Worker para uso offline
- [ ] Dashboard admin para metricas
- [ ] Internacionalizacao (i18n) alem de pt-BR

---

## Comandos Uteis

```bash
# Subir o PDF engine (rodar da raiz do projeto!)
docker compose up -d

# Dev server com hot reload
npm run dev

# Rebuild do engine apos mudancas no source
docker compose build virae-pdf && docker compose up -d virae-pdf

# Ver logs do engine
docker logs -f virae-pdf-engine
```

---

## Notas Importantes

- O Stirling PDF v0.46.2 e MIT. Versoes mais novas sao AGPL/comercial. NAO atualizar.
- O engine NAO edita texto existente em PDFs — apenas adiciona anotacoes (texto, desenho, highlight, carimbo) por cima
- SYSTEM_ROOTURIPATH e pathRewrite DEVEM ser identicos (`/engine/pdf`)
- O docker compose DEVE ser rodado da raiz do projeto, nao de `engine/pdf/`
- As cores Virae ja estao aplicadas no engine (theme.dark.css, theme.light.css)
