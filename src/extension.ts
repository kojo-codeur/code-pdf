import * as vscode from 'vscode';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import puppeteer from 'puppeteer';

const EXTENSION_NAME = 'Code Pdf';
const EXTENSION_VERSION = '1.0.0';
const PAGE_TIMEOUT_MS = 60000;
const PDF_TIMEOUT_MS = 120000;

interface PdfConfig {
    title: string;
    authorName: string;
    authorEmail: string;
    theme: 'light' | 'dark';
    fontSize: number;
    fontFamilyCode: string;
    marginTop: string;
    marginBottom: string;
    marginLeft: string;
    marginRight: string;
    logoPath: string;
    includePatterns: string;
    excludePatterns: string;
    enableFileSelection: boolean;
    authorYouTube: string;
}

function getDefaultConfig(): PdfConfig {
    const cfg = vscode.workspace.getConfiguration('codePdf');
    const defaultInclude = '**/*.{js,ts,py,html,css,php,java,cpp,go,rs,sh,json,md,png,jpg,jpeg,gif,svg,ico,webp}';
    return {
        title: cfg.get('title', 'CODE PDF'),
        authorName: cfg.get('authorName', 'Votre Nom'),
        authorEmail: cfg.get('authorEmail', ''),
        theme: cfg.get('theme', 'light'),
        fontSize: cfg.get('fontSize', 12),
        fontFamilyCode: cfg.get('fontFamilyCode', 'Consolas, Monaco, "Courier New", monospace'),
        marginTop: cfg.get('marginTop', '20mm'),
        marginBottom: cfg.get('marginBottom', '20mm'),
        marginLeft: cfg.get('marginLeft', '15mm'),
        marginRight: cfg.get('marginRight', '15mm'),
        logoPath: cfg.get('logoPath', 'media/icon.png'),
        includePatterns: cfg.get('includePatterns', defaultInclude),
        excludePatterns: cfg.get('excludePatterns', 'node_modules,.git,dist,out,.vscode,.code-pdf,*.log,*.pdf'),
        enableFileSelection: true,
        authorYouTube: cfg.get('authorYouTube', '@kojo-codeur')
    };
}

function parsePatternList(str: string): string[] {
    if (!str) return [];
    return str.split(',').map(s => s.trim()).filter(s => s.length > 0);
}

// ------------------------------------------------------------------
// Provider pour la barre d'activité
// ------------------------------------------------------------------
class CodePdfViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'codePdf.codePdfView';
    private _view?: vscode.WebviewView;
    private _pdfBuffer?: Buffer;
    private _generationInProgress = false;
    private _currentConfig: PdfConfig;
    private readonly _extensionUri: vscode.Uri;

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._currentConfig = getDefaultConfig();
    }

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        _context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ): void {
        this._view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };
        webviewView.webview.html = this._getHtmlForWebview();
        this._setupMessageListener(webviewView.webview);
        webviewView.webview.postMessage({ command: 'initConfig', config: this._currentConfig });
    }

    private _setupMessageListener(webview: vscode.Webview): void {
        webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'generate':
                    await this._generatePdfAndUpdateView();
                    break;
                case 'generateWithConfig':
                    this._currentConfig = { ...this._currentConfig, ...message.config };
                    await this._generatePdfAndUpdateView();
                    break;
                case 'save':
                    await this._savePdfToDisk();
                    break;
                case 'print':
                    if (this._pdfBuffer) this._printPdf(this._pdfBuffer);
                    break;
                case 'ready':
                    if (this._pdfBuffer) this._sendPdfToWebview();
                    break;
            }
        });
    }

    private async _generatePdfAndUpdateView(): Promise<void> {
        if (this._generationInProgress) {
            vscode.window.showWarningMessage('Génération déjà en cours.');
            return;
        }
        this._generationInProgress = true;
        this._showLoading(true);
        const startTime = Date.now();

        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) throw new Error('Aucun dossier ouvert.');
            const rootPath = workspaceFolders[0].uri.fsPath;

            vscode.window.showInformationMessage('Démarrage de la génération...');
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Génération du PDF",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: "Préparation..." });
                this._pdfBuffer = await generatePdfFromWorkspace(rootPath, this._currentConfig, this._extensionUri, progress);
            });

            this._sendPdfToWebview();
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            vscode.window.showInformationMessage(`PDF généré en ${duration} secondes.`);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Erreur : ${errorMessage}`);
            this._showError(errorMessage);
        } finally {
            this._generationInProgress = false;
            this._showLoading(false);
        }
    }

    private async _savePdfToDisk(): Promise<void> {
        if (!this._pdfBuffer) {
            vscode.window.showWarningMessage('Aucun PDF généré.');
            return;
        }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const rootPath = workspaceFolders[0].uri.fsPath;
        const defaultUri = vscode.Uri.file(path.join(rootPath, 'code-export.pdf'));
        const saveUri = await vscode.window.showSaveDialog({ defaultUri: defaultUri, filters: { 'PDF Files': ['pdf'] } });
        if (saveUri) {
            try {
                await fsp.writeFile(saveUri.fsPath, this._pdfBuffer);
                vscode.window.showInformationMessage(`PDF enregistré : ${path.basename(saveUri.fsPath)}`);
            } catch (err) {
                vscode.window.showErrorMessage(`Erreur enregistrement : ${err}`);
            }
        }
    }

    private _printPdf(pdfBuffer: Buffer): void {
        const tempFile = path.join(os.tmpdir(), `code-pdf-print-${Date.now()}.pdf`);
        try {
            fs.writeFileSync(tempFile, pdfBuffer);
            vscode.env.openExternal(vscode.Uri.file(tempFile));
            setTimeout(() => fs.unlink(tempFile, () => { }), 120000);
        } catch (err) {
            vscode.window.showErrorMessage('Impossible d’ouvrir le PDF.');
        }
    }

    private _sendPdfToWebview(): void {
        if (this._view && this._pdfBuffer) {
            const base64 = this._pdfBuffer.toString('base64');
            this._view.webview.postMessage({ command: 'displayPdf', data: base64 });
        }
    }

    private _showLoading(loading: boolean): void {
        if (this._view) this._view.webview.postMessage({ command: 'loading', loading });
    }

    private _showError(message: string): void {
        if (this._view) this._view.webview.postMessage({ command: 'error', message });
    }

    private _getHtmlForWebview(): string {
        const logoUri = vscode.Uri.joinPath(this._extensionUri, 'media', 'icon.png');
        const logoPath = this._view?.webview.asWebviewUri(logoUri)?.toString() || '';
        return getWebviewHtml(logoPath);
    }
}

// ------------------------------------------------------------------
// Interface utilisateur (style plat, sans bordures arrondies ni latérales)
// ------------------------------------------------------------------
function getWebviewHtml(logoUri: string): string {
    return `<!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body {
                background: #1e1e2f;
                color: #e0e0e0;
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                padding: 24px;
                display: flex;
                gap: 24px;
                height: 100vh;
                overflow: hidden;
            }
            .config-panel {
                width: 340px;
                background: #2d2d3a;
                padding: 20px;
                overflow-y: auto;
                flex-shrink: 0;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                border: 1px solid #3e3e4e;
            }
            .config-panel h3 {
                font-size: 22px;
                font-weight: 600;
                margin-bottom: 24px;
                padding-bottom: 12px;
                border-bottom: 1px solid #4c9aff;
                display: flex;
                align-items: center;
                gap: 10px;
                color: #fff;
            }
            .config-panel h3 img {
                height: 28px;
                width: auto;
            }
            .config-section {
                background: #252532;
                padding: 16px;
                margin-bottom: 20px;
                border: 1px solid #3a3a48;
            }
            .config-section h4 {
                font-size: 14px;
                font-weight: 600;
                margin-bottom: 16px;
                color: #b0b0d0;
                letter-spacing: 0.5px;
                padding-left: 12px;
            }
            .config-group {
                margin-bottom: 16px;
            }
            .config-group label {
                display: block;
                font-size: 12px;
                font-weight: 500;
                margin-bottom: 6px;
                color: #b0b0c0;
            }
            .config-group input,
            .config-group select {
                width: 100%;
                background: #1e1e2a;
                border: 1px solid #3e3e4e;
                color: #ffffff;
                padding: 8px 12px;
                font-size: 13px;
                transition: all 0.2s;
            }
            .config-group input:focus,
            .config-group select:focus {
                outline: none;
                border-color: #4c9aff;
                box-shadow: 0 0 0 2px rgba(76,154,255,0.2);
            }
            .preview-area {
                flex: 1;
                background: #0d0d1a;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                border: 1px solid #2a2a38;
            }
            .toolbar {
                padding: 12px 16px;
                background: #252538;
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
                justify-content: center;
                border-bottom: 1px solid #3a3a48;
            }
            .toolbar button {
                background: #2d2d3a;
                border: none;
                color: #e0e0e0;
                padding: 6px 16px;
                cursor: pointer;
                font-size: 12px;
                font-weight: 500;
                transition: all 0.2s;
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }
            .toolbar button:hover {
                background: #3d3d50;
                transform: translateY(-1px);
            }
            .toolbar button:active { transform: translateY(1px); }
            .toolbar button:disabled { opacity: 0.5; cursor: not-allowed; }
            #pdfContainer {
                flex: 1;
                overflow: auto;
                display: flex;
                flex-direction: column;
                align-items: center;
                padding: 20px;
                background: #0a0a14;
            }
            canvas {
                box-shadow: 0 2px 8px rgba(0,0,0,0.2);
                background: white;
                max-width: 100%;
                height: auto;
            }
            .loader, .error-message {
                text-align: center;
                margin: 60px 20px;
                padding: 20px;
                background: #1e1e2a;
            }
            .loader { display: none; }
            .error-message {
                background: #442222;
                color: #ffaaaa;
                display: none;
            }
            #generateConfigBtn {
                background: #2c7a4d;
                width: 100%;
                padding: 12px;
                font-weight: 600;
                font-size: 14px;
                margin-top: 12px;
                transition: background 0.2s;
            }
            #generateConfigBtn:hover { background: #3e9a62; }
            ::-webkit-scrollbar { width: 8px; height: 8px; }
            ::-webkit-scrollbar-track { background: #1e1e2a; }
            ::-webkit-scrollbar-thumb { background: #4c4c6a; }
        </style>
        <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css">
        <script src="https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.min.js"></script>
    </head>
    <body>
        <div class="config-panel">
            <h3><img src="${logoUri}" alt="logo"> Code PDF</h3>
            <div class="config-section">
                <h4><i class="fas fa-edit"></i> Général</h4>
                <div class="config-group"><label>Titre</label><input type="text" id="title" placeholder="CODE PDF"></div>
            </div>
            <div class="config-section">
                <h4><i class="fas fa-user"></i> Auteur</h4>
                <div class="config-group"><label>Nom</label><input type="text" id="authorName" placeholder="Votre Nom"></div>
                <div class="config-group"><label>Email</label><input type="email" id="authorEmail" placeholder="contact@code-pdf.com"></div>
            </div>
            <div class="config-section">
                <h4><i class="fas fa-palette"></i> Apparence</h4>
                <div class="config-group"><label>Thème</label><select id="theme"><option value="light">Clair</option><option value="dark">Sombre</option></select></div>
                <div class="config-group"><label>Logo (relatif)</label><input type="text" id="logoPath" placeholder="media/icon.png"></div>
                <div class="config-group"><label>Taille police (px)</label><input type="number" id="fontSize" step="1" min="8" max="20"></div>
            </div>
            <div class="config-section">
                <h4><i class="fas fa-arrows-alt"></i> Marges (mm)</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                    <div class="config-group"><label>Haut</label><input type="text" id="marginTop" placeholder="20mm"></div>
                    <div class="config-group"><label>Bas</label><input type="text" id="marginBottom" placeholder="20mm"></div>
                    <div class="config-group"><label>Gauche</label><input type="text" id="marginLeft" placeholder="15mm"></div>
                    <div class="config-group"><label>Droite</label><input type="text" id="marginRight" placeholder="15mm"></div>
                </div>
            </div>
            <button id="generateConfigBtn"><i class="fas fa-sync-alt"></i> Générer le PDF</button>
        </div>
        <div class="preview-area">
            <div class="toolbar">
                <button id="saveBtn"><i class="fas fa-save"></i> Enregistrer</button>
                <button id="printBtn"><i class="fas fa-print"></i> Imprimer</button>
                <button id="zoomOutBtn"><i class="fas fa-search-minus"></i> Zoom -</button>
                <button id="zoomInBtn"><i class="fas fa-search-plus"></i> Zoom +</button>
                <span id="pageInfo" style="font-size:13px; margin:0 12px;">Page 1 / ?</span>
                <button id="prevBtn" disabled><i class="fas fa-chevron-left"></i> Préc.</button>
                <button id="nextBtn" disabled>Suiv. <i class="fas fa-chevron-right"></i></button>
            </div>
            <div id="pdfContainer">
                <div class="loader" id="loader"><i class="fas fa-spinner fa-pulse"></i> Génération en cours...</div>
                <div class="error-message" id="errorMsg"></div>
                <canvas id="pdfCanvas" style="display:none;"></canvas>
            </div>
        </div>
        <script>
            const vscode = acquireVsCodeApi();
            let pdfDoc = null, pageNum = 1, scale = 1.2, rendering = false, pendingPage = null;
            const canvas = document.getElementById('pdfCanvas');
            const ctx = canvas.getContext('2d');

            function loadConfigIntoForm(config) {
                document.getElementById('title').value = config.title || '';
                document.getElementById('authorName').value = config.authorName || '';
                document.getElementById('authorEmail').value = config.authorEmail || '';
                document.getElementById('theme').value = config.theme || 'light';
                document.getElementById('logoPath').value = config.logoPath || '';
                document.getElementById('marginTop').value = config.marginTop || '20mm';
                document.getElementById('marginBottom').value = config.marginBottom || '20mm';
                document.getElementById('marginLeft').value = config.marginLeft || '15mm';
                document.getElementById('marginRight').value = config.marginRight || '15mm';
                document.getElementById('fontSize').value = config.fontSize || 12;
            }

            function getConfigFromForm() {
                return {
                    title: document.getElementById('title').value,
                    authorName: document.getElementById('authorName').value,
                    authorEmail: document.getElementById('authorEmail').value,
                    theme: document.getElementById('theme').value,
                    logoPath: document.getElementById('logoPath').value,
                    fontSize: parseInt(document.getElementById('fontSize').value) || 12,
                    fontFamilyCode: 'Consolas, Monaco, monospace',
                    marginTop: document.getElementById('marginTop').value,
                    marginBottom: document.getElementById('marginBottom').value,
                    marginLeft: document.getElementById('marginLeft').value,
                    marginRight: document.getElementById('marginRight').value,
                    authorYouTube: '@kojo-codeur'
                };
            }

            document.getElementById('generateConfigBtn').onclick = () => {
                const config = getConfigFromForm();
                vscode.postMessage({ command: 'generateWithConfig', config });
                document.getElementById('loader').style.display = 'block';
                document.getElementById('pdfCanvas').style.display = 'none';
                document.getElementById('errorMsg').style.display = 'none';
            };
            document.getElementById('saveBtn').onclick = () => vscode.postMessage({ command: 'save' });
            document.getElementById('printBtn').onclick = () => vscode.postMessage({ command: 'print' });

            function renderPage(num) {
                if (!pdfDoc) return;
                if (rendering) { pendingPage = num; return; }
                rendering = true;
                pdfDoc.getPage(num).then(page => {
                    const viewport = page.getViewport({ scale });
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;
                    page.render({ canvasContext: ctx, viewport }).promise.then(() => {
                        rendering = false;
                        if (pendingPage !== null) { renderPage(pendingPage); pendingPage = null; }
                        updateButtons();
                    }).catch(() => { rendering = false; updateButtons(); });
                }).catch(() => { rendering = false; updateButtons(); });
                document.getElementById('pageInfo').innerText = 'Page ' + num + ' / ' + pdfDoc.numPages;
            }

            function updateButtons() {
                if (pdfDoc) {
                    document.getElementById('prevBtn').disabled = (pageNum <= 1);
                    document.getElementById('nextBtn').disabled = (pageNum >= pdfDoc.numPages);
                }
            }

            document.getElementById('prevBtn').onclick = () => { if (pageNum > 1) { pageNum--; renderPage(pageNum); } };
            document.getElementById('nextBtn').onclick = () => { if (pdfDoc && pageNum < pdfDoc.numPages) { pageNum++; renderPage(pageNum); } };
            document.getElementById('zoomInBtn').onclick = () => { scale += 0.2; renderPage(pageNum); };
            document.getElementById('zoomOutBtn').onclick = () => { if (scale > 0.6) scale -= 0.2; renderPage(pageNum); };

            window.addEventListener('message', event => {
                const msg = event.data;
                if (msg.command === 'initConfig') loadConfigIntoForm(msg.config);
                else if (msg.command === 'displayPdf') {
                    document.getElementById('loader').style.display = 'none';
                    document.getElementById('pdfCanvas').style.display = 'block';
                    document.getElementById('errorMsg').style.display = 'none';
                    const pdfData = atob(msg.data);
                    const uint8Array = new Uint8Array(pdfData.length);
                    for (let i = 0; i < pdfData.length; i++) uint8Array[i] = pdfData.charCodeAt(i);
                    pdfjsLib.getDocument({ data: uint8Array }).promise.then(pdf => { pdfDoc = pdf; pageNum = 1; renderPage(pageNum); })
                        .catch(err => { document.getElementById('errorMsg').innerText = 'Erreur de chargement du PDF'; document.getElementById('errorMsg').style.display = 'block'; });
                } else if (msg.command === 'loading') {
                    if (msg.loading) { document.getElementById('loader').style.display = 'block'; document.getElementById('pdfCanvas').style.display = 'none'; }
                    else { document.getElementById('loader').style.display = 'none'; }
                } else if (msg.command === 'error') {
                    document.getElementById('loader').style.display = 'none';
                    document.getElementById('errorMsg').innerText = msg.message;
                    document.getElementById('errorMsg').style.display = 'block';
                }
            });
            vscode.postMessage({ command: 'ready' });
        </script>
    </body>
    </html>`;
}

// ------------------------------------------------------------------
// Panel pour la commande (Ctrl+Shift+P) avec icône d’onglet
// ------------------------------------------------------------------
class CodePdfPanel {
    public static currentPanel: CodePdfPanel | undefined;
    private readonly _panel: vscode.WebviewPanel;
    private _disposables: vscode.Disposable[] = [];
    private _pdfBuffer?: Buffer;
    private _generationInProgress = false;
    private _currentConfig: PdfConfig;
    private readonly _extensionUri: vscode.Uri;

    private constructor(panel: vscode.WebviewPanel, extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;
        this._panel = panel;
        this._currentConfig = getDefaultConfig();
        this._panel.webview.options = { enableScripts: true, localResourceRoots: [extensionUri] };
        const logoUri = vscode.Uri.joinPath(extensionUri, 'media', 'icon.png');
        const logoPath = panel.webview.asWebviewUri(logoUri).toString();
        this._panel.webview.html = getWebviewHtml(logoPath);
        this._panel.onDidDispose(() => this.dispose(), null, this._disposables);
        this._setupMessageListener(this._panel.webview);
        this._panel.webview.postMessage({ command: 'initConfig', config: this._currentConfig });
    }

    public static createOrShow(extensionUri: vscode.Uri) {
        const column = vscode.window.activeTextEditor ? vscode.window.activeTextEditor.viewColumn : undefined;
        if (CodePdfPanel.currentPanel) {
            CodePdfPanel.currentPanel._panel.reveal(column);
            return;
        }
        const panel = vscode.window.createWebviewPanel(
            'codePdf',
            'Code PDF - Génération',
            column || vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [extensionUri],
                iconPath: vscode.Uri.joinPath(extensionUri, 'media', 'icon.png')
            }
        );
        CodePdfPanel.currentPanel = new CodePdfPanel(panel, extensionUri);
    }

    private _setupMessageListener(webview: vscode.Webview): void {
        webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case 'generate': await this._generatePdf(); break;
                case 'generateWithConfig':
                    this._currentConfig = { ...this._currentConfig, ...message.config };
                    await this._generatePdf();
                    break;
                case 'save': await this._savePdfToDisk(); break;
                case 'print': if (this._pdfBuffer) this._printPdf(this._pdfBuffer); break;
                case 'ready': if (this._pdfBuffer) this._sendPdfToWebview(); break;
            }
        });
    }

    private async _generatePdf(): Promise<void> {
        if (this._generationInProgress) { vscode.window.showWarningMessage('Génération déjà en cours.'); return; }
        this._generationInProgress = true;
        this._showLoading(true);
        const startTime = Date.now();
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) throw new Error('Aucun dossier ouvert.');
            const rootPath = workspaceFolders[0].uri.fsPath;
            vscode.window.showInformationMessage('Génération PDF...');
            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Génération en cours",
                cancellable: false
            }, async (progress) => {
                progress.report({ increment: 0, message: "Analyse..." });
                this._pdfBuffer = await generatePdfFromWorkspace(rootPath, this._currentConfig, this._extensionUri, progress);
            });
            this._sendPdfToWebview();
            const duration = ((Date.now() - startTime) / 1000).toFixed(1);
            vscode.window.showInformationMessage(`PDF prêt en ${duration} s.`);
        } catch (err) {
            const errorMessage = err instanceof Error ? err.message : String(err);
            vscode.window.showErrorMessage(`Erreur : ${errorMessage}`);
            this._showError(errorMessage);
        } finally {
            this._generationInProgress = false;
            this._showLoading(false);
        }
    }

    private async _savePdfToDisk(): Promise<void> {
        if (!this._pdfBuffer) { vscode.window.showWarningMessage('Aucun PDF.'); return; }
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) return;
        const rootPath = workspaceFolders[0].uri.fsPath;
        const defaultUri = vscode.Uri.file(path.join(rootPath, 'code-export.pdf'));
        const saveUri = await vscode.window.showSaveDialog({ defaultUri: defaultUri, filters: { 'PDF Files': ['pdf'] } });
        if (saveUri) {
            try {
                await fsp.writeFile(saveUri.fsPath, this._pdfBuffer);
                vscode.window.showInformationMessage(`Sauvegardé : ${path.basename(saveUri.fsPath)}`);
            } catch (err) { vscode.window.showErrorMessage(`Erreur : ${err}`); }
        }
    }

    private _printPdf(pdfBuffer: Buffer): void {
        const tempFile = path.join(os.tmpdir(), `code-pdf-print-${Date.now()}.pdf`);
        try {
            fs.writeFileSync(tempFile, pdfBuffer);
            vscode.env.openExternal(vscode.Uri.file(tempFile));
            setTimeout(() => fs.unlink(tempFile, () => { }), 120000);
        } catch (err) { vscode.window.showErrorMessage('Impossible d’ouvrir le PDF.'); }
    }

    private _sendPdfToWebview(): void {
        if (this._pdfBuffer) {
            const base64 = this._pdfBuffer.toString('base64');
            this._panel.webview.postMessage({ command: 'displayPdf', data: base64 });
        }
    }

    private _showLoading(loading: boolean): void { this._panel.webview.postMessage({ command: 'loading', loading }); }
    private _showError(message: string): void { this._panel.webview.postMessage({ command: 'error', message }); }
    public dispose(): void { CodePdfPanel.currentPanel = undefined; this._panel.dispose(); while (this._disposables.length) this._disposables.pop()?.dispose(); }
}

// ------------------------------------------------------------------
// Fonctions de génération PDF (optimisées)
// ------------------------------------------------------------------
async function getAllFilesWithPatterns(rootPath: string, config: PdfConfig): Promise<string[]> {
    let includeArray = parsePatternList(config.includePatterns);
    const excludeArray = parsePatternList(config.excludePatterns);
    if (includeArray.length === 0) includeArray = ['**/*'];

    let allUris: vscode.Uri[] = [];
    for (const inc of includeArray) {
        try {
            const uris = await vscode.workspace.findFiles(
                new vscode.RelativePattern(rootPath, inc),
                excludeArray.map(ex => new vscode.RelativePattern(rootPath, ex))
            );
            allUris.push(...uris);
        } catch (err) {
            vscode.window.showWarningMessage(`Pattern invalide : ${inc}`);
        }
    }
    const uniqueMap = new Map<string, vscode.Uri>();
    for (const uri of allUris) uniqueMap.set(uri.fsPath, uri);
    return Array.from(uniqueMap.values()).map(uri => uri.fsPath);
}

async function generatePdfFromWorkspace(
    rootPath: string,
    config: PdfConfig,
    extensionUri: vscode.Uri,
    progress?: vscode.Progress<{ message?: string; increment?: number }>
): Promise<Buffer> {
    // Sélection manuelle des fichiers (toujours active)
    const tempConfig = { ...config, includePatterns: '**/*' };
    const allFiles = await getAllFilesWithPatterns(rootPath, tempConfig);
    if (allFiles.length === 0) throw new Error('Aucun fichier trouvé.');
    const items = allFiles.map(f => ({ label: path.relative(rootPath, f), description: '', fspath: f }));
    const selected = await vscode.window.showQuickPick(items, { canPickMany: true, placeHolder: `Sélectionnez les fichiers (${allFiles.length} disponibles)` });
    if (!selected || selected.length === 0) throw new Error('Aucun fichier sélectionné.');
    const files = selected.map(s => s.fspath);
    vscode.window.showInformationMessage(`${files.length} fichier(s) sélectionné(s).`);

    if (files.length === 0) throw new Error(`Aucun fichier correspondant.`);
    if (files.length > 500) {
        const answer = await vscode.window.showWarningMessage(`${files.length} fichiers. La génération peut être lente. Continuer ?`, 'Continuer', 'Annuler');
        if (answer !== 'Continuer') throw new Error('Annulé.');
    }

    progress?.report({ increment: 10, message: `✅ ${files.length} fichiers trouvés.` });
    const tempDir = path.join(rootPath, '.code-pdf');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
    const tempHtmlPath = path.join(tempDir, 'temp_export.html');
    const writeStream = fs.createWriteStream(tempHtmlPath);
    await writeHtmlHeader(writeStream, rootPath, files.length, config, extensionUri);
    progress?.report({ increment: 20, message: "Écriture des fichiers..." });

    let processed = 0;
    for (const file of files) {
        await writeFileContent(writeStream, rootPath, file, config);
        processed++;
        if (processed % 50 === 0) progress?.report({ increment: 0, message: `📄 ${processed}/${files.length} fichiers` });
    }
    writeStream.write(`</body></html>`);
    writeStream.end();
    await new Promise((resolve, reject) => { writeStream.on('finish', resolve); writeStream.on('error', reject); });

    progress?.report({ increment: 70, message: "Conversion HTML → PDF..." });
    const pdfBuffer = await convertHtmlToPdf(tempHtmlPath, config);
    await fsp.unlink(tempHtmlPath).catch(() => { });
    progress?.report({ increment: 100, message: "Terminé" });
    return pdfBuffer;
}

function isImageFile(filePath: string): boolean {
    const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.bmp'];
    const ext = path.extname(filePath).toLowerCase();
    return imageExtensions.includes(ext);
}

async function writeFileContent(writeStream: fs.WriteStream, rootPath: string, filePath: string, config: PdfConfig): Promise<void> {
    const relativePath = path.relative(rootPath, filePath);
    if (isImageFile(filePath)) {
        try {
            const imageBuffer = await fsp.readFile(filePath);
            const base64 = imageBuffer.toString('base64');
            const mimeType = getMimeType(filePath);
            const imgSrc = `data:${mimeType};base64,${base64}`;
            writeStream.write(`
                <div class="file-card">
                    <div class="file-title"><i class="fas fa-image"></i> ${escapeHtml(relativePath)}</div>
                    <div style="text-align: center; padding: 16px;">
                        <img src="${imgSrc}" style="max-width: 100%; max-height: 600px;" alt="${escapeHtml(relativePath)}">
                    </div>
                </div>
            `);
        } catch (err) {
            writeStream.write(`
                <div class="file-card">
                    <div class="file-title"><i class="fas fa-image"></i> ${escapeHtml(relativePath)}</div>
                    <pre style="color: red;">Erreur : impossible de lire l'image</pre>
                </div>
            `);
        }
    } else {
        let content = '';
        try {
            content = await fsp.readFile(filePath, 'utf-8');
        } catch {
            content = '[Fichier binaire ou non lisible]';
        }
        const lang = getLanguageExtension(relativePath);
        writeStream.write(`
            <div class="file-card">
                <div class="file-title"><i class="fas fa-file-code"></i> ${escapeHtml(relativePath)}</div>
                <pre><code class="language-${lang} hljs">${escapeHtml(content)}</code></pre>
            </div>
        `);
    }
}

async function writeHtmlHeader(writeStream: fs.WriteStream, rootPath: string, fileCount: number, config: PdfConfig, extensionUri: vscode.Uri): Promise<void> {
    const projectName = path.basename(rootPath);
    const currentDate = new Date().toLocaleString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const highlightTheme = config.theme === 'dark' ? 'github-dark' : 'github';
    const bgColor = config.theme === 'dark' ? '#0d1117' : '#ffffff';
    const textColor = config.theme === 'dark' ? '#c9d1d9' : '#24292e';
    const borderColor = config.theme === 'dark' ? '#30363d' : '#e1e4e8';

    let logoBase64 = '';
    if (config.logoPath && config.logoPath.trim() !== '') {
        let logoFullPath = path.join(extensionUri.fsPath, config.logoPath);
        if (!fs.existsSync(logoFullPath)) {
            logoFullPath = path.isAbsolute(config.logoPath) ? config.logoPath : path.join(rootPath, config.logoPath);
        }
        if (fs.existsSync(logoFullPath)) {
            const logoBuffer = fs.readFileSync(logoFullPath);
            const mime = getMimeType(logoFullPath);
            logoBase64 = `data:${mime};base64,${logoBuffer.toString('base64')}`;
        }
    }

    const youtubeUrl = `https://www.youtube.com/${config.authorYouTube}`;
    const creatorLink = `<a href="${youtubeUrl}" target="_blank" style="color: #58a6ff; text-decoration: none;">kojo-codeur</a>`;

    writeStream.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Export - ${escapeHtml(projectName)}</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.6.0/css/all.min.css">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${highlightTheme}.min.css">
    <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
    <style>
        *{margin:0;padding:0;box-sizing:border-box;}
        body{background:${bgColor};color:${textColor};font-family:'Georgia',serif;line-height:1.5;}
        .cover {
            height: 100vh;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
            align-items: center;
            text-align: center;
            background: ${bgColor};
            padding: 40px 20px;
            page-break-after: avoid;
        }
        .cover-content { flex:1; display:flex; flex-direction:column; justify-content:center; align-items:center; }
        .cover h1 { font-size:48px; font-family:'Arial',sans-serif; margin:20px 0; color:${config.theme==='dark'?'#58a6ff':'#0969da'}; }
        .cover .project-name { font-size:28px; font-weight:bold; margin-bottom:20px; }
        .cover .logo { max-width:150px; max-height:80px; margin-bottom:30px; }
        .cover .description { font-size:20px; color:#8a8d91; margin-bottom:40px; }
        .cover .stats { font-size:16px; margin-top:20px; color:#8a8d91; }
        .cover-footer { margin-top:auto; padding:20px; font-size:14px; border-top:1px solid ${borderColor}; width:100%; }
        .file-card {
            margin: 30px 20px;
            border: 1px solid ${borderColor};
            overflow: hidden;
            page-break-before: always;
            background: ${bgColor};
        }
        .file-title {
            background: ${config.theme === 'dark' ? '#161b22' : '#f6f8fa'};
            padding: 12px 16px;
            font-weight: 600;
            font-family: ${config.fontFamilyCode};
            border-bottom: 1px solid ${borderColor};
        }
        pre {
            margin: 0;
            padding: 16px;
            overflow-x: auto;
            white-space: pre-wrap;
            word-break: break-word;
        }
        code {
            font-family: ${config.fontFamilyCode};
            font-size: ${config.fontSize}px;
            line-height: 1.5;
            white-space: pre-wrap;
            word-break: break-word;
        }
        .page-footer {
            position: fixed;
            bottom: 10mm;
            left: 0;
            right: 0;
            text-align: center;
            font-size: 10px;
            color: #6e7781;
            border-top: 1px solid ${borderColor};
            padding-top: 5px;
            background: ${bgColor};
        }
        @media print { .page-footer { position: fixed; bottom: 0; } }
    </style></head><body>
    <div class="cover">
        <div class="cover-content">
            ${logoBase64 ? `<img class="logo" src="${logoBase64}" alt="Logo">` : '<div style="width:100px;height:100px;background:#0969da;display:flex;align-items:center;justify-content:center;font-size:40px;color:white;margin-bottom:30px;">&lt;/&gt;</div>'}
            <h1>${escapeHtml(config.title)}</h1>
            <div class="project-name">${escapeHtml(projectName)}</div>
            <div class="description">Exportation complète du code source</div>
            <div class="stats">
                <div>${currentDate}</div>
                <div>${fileCount} fichier(s)</div>
                <div>Généré par ${escapeHtml(config.authorName)}</div>
            </div>
        </div>
        <div class="cover-footer">
            Extension créée par ${creatorLink}
        </div>
    </div>
    `);
}

async function convertHtmlToPdf(htmlPath: string, config: PdfConfig): Promise<Buffer> {
    let browser;
    try {
        const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
        if (fs.existsSync(chromePath)) {
            browser = await puppeteer.launch({ headless: true, executablePath: chromePath, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
        } else {
            browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        }
    } catch (err) { throw new Error(`Chrome introuvable : ${err}`); }
    
    const page = await browser.newPage();
    await page.goto(`file://${htmlPath.replace(/\\/g, '/')}`, { waitUntil: 'load', timeout: PAGE_TIMEOUT_MS });
    
    // Coloration syntaxique rapide
    await page.evaluate(() => {
        if (typeof hljs !== 'undefined') {
            document.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block);
            });
        }
    });
    
    const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: config.marginTop, bottom: config.marginBottom, left: config.marginLeft, right: config.marginRight },
        timeout: PDF_TIMEOUT_MS
    });
    await browser.close();
    return Buffer.from(pdfBuffer);
}

function getMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
        case '.png': return 'image/png';
        case '.jpg': case '.jpeg': return 'image/jpeg';
        case '.gif': return 'image/gif';
        case '.svg': return 'image/svg+xml';
        case '.ico': return 'image/x-icon';
        case '.webp': return 'image/webp';
        case '.bmp': return 'image/bmp';
        default: return 'image/png';
    }
}

function getLanguageExtension(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const map: Record<string, string> = {
        '.js':'javascript','.ts':'typescript','.jsx':'javascript','.tsx':'typescript',
        '.py':'python','.html':'html','.css':'css','.scss':'scss','.json':'json',
        '.md':'markdown','.java':'java','.c':'c','.cpp':'cpp','.h':'c','.hpp':'cpp',
        '.php':'php','.rb':'ruby','.go':'go','.rs':'rust','.sh':'bash','.bat':'batch',
        '.ps1':'powershell','.xml':'xml','.yaml':'yaml','.yml':'yaml','.toml':'toml',
        '.ini':'ini','.cfg':'ini','.conf':'ini','.gitignore':'plaintext',
        '.vue':'vue','.svelte':'svelte','.kt':'kotlin','.swift':'swift','.cs':'csharp'
    };
    return map[ext] || 'plaintext';
}

function escapeHtml(str: string): string {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ------------------------------------------------------------------
// Activation
// ------------------------------------------------------------------
export function activate(context: vscode.ExtensionContext): void {
    console.log(`${EXTENSION_NAME} v${EXTENSION_VERSION} activée`);
    const provider = new CodePdfViewProvider(context.extensionUri);
    context.subscriptions.push(vscode.window.registerWebviewViewProvider(CodePdfViewProvider.viewType, provider));
    context.subscriptions.push(vscode.commands.registerCommand('code-pdf.generateCodePdf', () => CodePdfPanel.createOrShow(context.extensionUri)));
}

export function deactivate(): void { }