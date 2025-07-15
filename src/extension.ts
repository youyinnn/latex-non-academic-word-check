import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

type Category = {
  desc: string;
  words: { [word: string]: string };
};
type Categories = { [category: string]: Category };

function loadCategories(context: vscode.ExtensionContext): Categories {
  const keywordsPath = path.join(context.extensionPath, "words.json");
  if (fs.existsSync(keywordsPath)) {
    try {
      const content = fs.readFileSync(keywordsPath, "utf8");
      return JSON.parse(content);
    } catch (e) {
      vscode.window.showErrorMessage("Failed to parse words.json");
      return {};
    }
  } else {
    vscode.window.showWarningMessage(
      "words.json not found in extension directory"
    );
    return {};
  }
}

export function activate(context: vscode.ExtensionContext) {
  let categories = loadCategories(context);

  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("tex-keyword");

  function updateDiagnostics(editor: vscode.TextEditor | undefined) {
    if (!editor || !editor.document.fileName.endsWith(".tex")) return;

    const text = editor.document.getText();
    const diagnostics: vscode.Diagnostic[] = [];

    for (const [category, info] of Object.entries(categories)) {
      const desc = info["desc"];
      const words = info["words"];

      for (const [word, suggestion] of Object.entries(words)) {
        // 注意：正则要转义特殊字符
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regEx = new RegExp(`\\b${escapedWord}\\b`, "gi");
        let match;
        while ((match = regEx.exec(text))) {
          const startPos = editor.document.positionAt(match.index);
          const endPos = editor.document.positionAt(
            match.index + match[0].length
          );
          const range = new vscode.Range(startPos, endPos);

          // 构建 warning 内容
          const message = `[${category}]\n${desc}\n\nSuggestion: ${suggestion}`;

          const diagnostic = new vscode.Diagnostic(
            range,
            message,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostics.push(diagnostic);
        }
      }
    }

    diagnosticCollection.set(editor.document.uri, diagnostics);
  }

  // 文件切换、内容变更时更新
  vscode.window.onDidChangeActiveTextEditor(
    (editor) => updateDiagnostics(editor),
    null,
    context.subscriptions
  );
  vscode.workspace.onDidChangeTextDocument(
    (event) => {
      if (
        vscode.window.activeTextEditor &&
        event.document === vscode.window.activeTextEditor.document
      ) {
        updateDiagnostics(vscode.window.activeTextEditor);
      }
    },
    null,
    context.subscriptions
  );

  // 启动时更新
  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(diagnosticCollection);
}

export function deactivate() {}
