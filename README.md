# Code PDF – Exportez votre code en PDF professionnel

[![Version](https://img.shields.io/visual-studio-marketplace/v/kojo-codeur.code-pdf)](https://marketplace.visualstudio.com/items?itemName=kojo-codeur.code-pdf)
[![Installs](https://img.shields.io/visual-studio-marketplace/i/kojo-codeur.code-pdf)](https://marketplace.visualstudio.com/items?itemName=kojo-codeur.code-pdf)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Une extension Visual Studio Code qui transforme l'intégralité de votre code source en un **document PDF professionnel** avec coloration syntaxique, page de garde personnalisable et aperçu intégré.

## ✨ Fonctionnalités

- 📄 **Génération PDF instantanée** – Transformez un ou plusieurs fichiers en PDF avec un seul clic.
- 🎨 **Coloration syntaxique** – Plus de 100 langages reconnus (via Highlight.js).
- 🖼️ **Support des images** – Les images (PNG, JPG, GIF, SVG, ICO, WEBP) sont intégrées directement dans le PDF.
- 📑 **Page de garde personnalisable** – Titre, logo, date, nombre de fichiers, auteur, lien YouTube.
- 🔍 **Aperçu intégré** – Navigation page par page, zoom, impression et sauvegarde dans VS Code.
- ⚡ **Haute performance** – Gère des projets de plusieurs milliers de fichiers sans ralentissement.

## 📋 Prérequis

- VS Code version `^1.85.0` ou supérieure
- Node.js (pour le développement uniquement)

## 🚀 Installation

### Via le Marketplace VS Code

1. Lancez VS Code.
2. Ouvrez l'onglet Extensions (`Ctrl+Shift+X`).
3. Recherchez `Code PDF`.
4. Cliquez sur **Installer**.

### Installation manuelle (fichier .vsix)

```bash
code --install-extension code-pdf-1.0.0.vsix


Code pdf est une extension VS Code qui génère un **fichier PDF de l’intégralité de votre code source** avec :
- Coloration syntaxique (via Highlight.js)
- Mise en page claire et professionnelle (page de garde, sauts de page par fichier)
- Prévisualisation intégrée dans VS Code
- Enregistrement à la demande (pas de fichier automatique)

## Installation
1. Téléchargez l’extension depuis le Marketplace ou installez‑la manuellement.
2. Ouvrez un dossier contenant votre code source.
3. Lancez la commande `Code Pdf : Générer un PDF du code` (Ctrl+Shift+P).

## Fonctionnalités
- **Page de garde** : nom du projet, date, nombre de fichiers, logo, liens sociaux.
- **Coloration syntaxique** : plus de 100 langages reconnus.
- **Performance** : même pour les gros projets (fichier HTML temporaire).
- **Aperçu** : navigation page par page, zoom, téléchargement.

## Configuration
Vous pouvez personnaliser les polices en plaçant vos propres fichiers `.ttf` dans le dossier `dist/data` de l’extension.
Les polices par défaut sont `FreeSerif` et `FreeSans`.

## Dépendances
- Puppeteer (navigateur Chromium inclus) – première exécution un peu lente.

## Auteur
Créé par **kojo-codeur** – [GitHub](https://github.com/kojo-codeur)

## Licence
MIT