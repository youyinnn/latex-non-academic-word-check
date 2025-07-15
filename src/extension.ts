import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import * as commentJson from "comment-json";

type WordInfo = {
  suggestion: string;
  example: string;
};
type Category = {
  desc: string;
  words: { [word: string]: WordInfo };
};
type Categories = { [category: string]: Category };

const dismissedWarnings = new Set<string>();
function makeWarningKey(uri: vscode.Uri, range: vscode.Range, word: string) {
  return `${uri.toString()}#${range.start.line}:${
    range.start.character
  }-${word}`;
}

function isCategories(obj: unknown): obj is Categories {
  if (typeof obj !== "object" || obj === null) {
    return false;
  }
  for (const key in obj as object) {
    const cat = (obj as any)[key];
    if (
      typeof cat !== "object" ||
      cat === null ||
      typeof cat.desc !== "string" ||
      typeof cat.words !== "object" ||
      cat.words === null
    ) {
      return false;
    }
  }
  return true;
}

function loadCategories(context: vscode.ExtensionContext): Categories {
  const keywordsPath = path.join(context.extensionPath, "keywords.json");
  if (fs.existsSync(keywordsPath)) {
    try {
      const content = fs.readFileSync(keywordsPath, "utf8");
      const parsed = commentJson.parse(content);
      if (isCategories(parsed)) {
        return parsed;
      }
      return {};
    } catch (e) {
      vscode.window.showErrorMessage("Failed to parse keywords.json");
      return {};
    }
  } else {
    vscode.window.showWarningMessage(
      "keywords.json not found in extension directory"
    );
    return {};
  }
}

export function activate(context: vscode.ExtensionContext) {
  let categories = loadCategories(context);

  const diagnosticCollection =
    vscode.languages.createDiagnosticCollection("tex-keyword");

  // 检查指定文档内容
  function checkDocument(
    document: vscode.TextDocument,
    categories: Categories
  ): vscode.Diagnostic[] {
    const diagnostics: vscode.Diagnostic[] = [];
    const text = document.getText();

    for (const [category, catInfo] of Object.entries(categories)) {
      const desc = catInfo["desc"];
      const words = catInfo["words"];

      for (const [word, info] of Object.entries(words)) {
        const suggestion = info["suggestion"];
        const example = info["example"];
        const escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const regEx = new RegExp(`\\b${escapedWord}\\b`, "gi");
        let match;
        while ((match = regEx.exec(text))) {
          const startPos = document.positionAt(match.index);
          const endPos = document.positionAt(match.index + match[0].length);
          const range = new vscode.Range(startPos, endPos);
          const key = makeWarningKey(document.uri, range, word);
          // dismiss
          if (dismissedWarnings.has(key)) {
            continue;
          }
          const message = `Avoid \"${word}\"\n\nSuggestion: ${suggestion}\n\nIn Category: [${category}]\n${desc}\n\nExample: ${example}`;

          const diagnostic = new vscode.Diagnostic(
            range,
            message,
            vscode.DiagnosticSeverity.Warning
          );
          diagnostic.source = "tex-keyword";
          diagnostics.push(diagnostic);
        }
      }
    }
    return diagnostics;
  }

  // 检查当前激活文档
  function updateDiagnostics(editor: vscode.TextEditor | undefined) {
    if (!editor || !editor.document.fileName.endsWith(".tex")) {
      return;
    }
    const diagnostics = checkDocument(editor.document, categories);
    diagnosticCollection.set(editor.document.uri, diagnostics);
  }

  // 检查所有 tex 文件
  async function checkAllTexFiles() {
    // 清空旧 diagnostics
    diagnosticCollection.clear();

    // 查找所有 tex 文件
    const files = await vscode.workspace.findFiles("**/*.tex");
    for (const file of files) {
      try {
        const document = await vscode.workspace.openTextDocument(file);
        const diagnostics = checkDocument(document, categories);
        diagnosticCollection.set(file, diagnostics);
      } catch (e) {
        vscode.window.showWarningMessage(
          `Failed to check file: ${file.fsPath}`
        );
      }
    }
    vscode.window.showInformationMessage(
      `Checked ${files.length} .tex files in the project.`
    );
  }

  // 事件绑定
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

  if (vscode.window.activeTextEditor) {
    updateDiagnostics(vscode.window.activeTextEditor);
  }

  context.subscriptions.push(diagnosticCollection);

  // 注册命令
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.checkAllTexFiles",
      checkAllTexFiles
    )
  );

  class DismissWarningProvider implements vscode.CodeActionProvider {
    provideCodeActions(
      document: vscode.TextDocument,
      range: vscode.Range,
      context: vscode.CodeActionContext,
      token: vscode.CancellationToken
    ) {
      const actions: vscode.CodeAction[] = [];
      for (const diagnostic of context.diagnostics) {
        if (diagnostic.source === "tex-keyword") {
          const word = getWordAtRange(document, diagnostic.range);
          const key = makeWarningKey(document.uri, diagnostic.range, word);
          const action = new vscode.CodeAction(
            "Dismiss this warning",
            vscode.CodeActionKind.QuickFix
          );
          action.command = {
            title: "Dismiss warning",
            command: "extension.dismissWarning",
            arguments: [key],
          };
          action.diagnostics = [diagnostic];
          action.isPreferred = true;
          actions.push(action);
        }
      }
      return actions;
    }
  }

  // 注册 Dismiss 命令
  context.subscriptions.push(
    vscode.commands.registerCommand(
      "extension.dismissWarning",
      (key: string) => {
        dismissedWarnings.add(key);
        if (vscode.window.activeTextEditor) {
          updateDiagnostics(vscode.window.activeTextEditor);
        }
      }
    )
  );

  // 注册 CodeActionProvider
  context.subscriptions.push(
    vscode.languages.registerCodeActionsProvider(
      { scheme: "file", language: "latex" },
      new DismissWarningProvider(),
      { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
    )
  );

  // CodeActionProvider 实现
  function getWordAtRange(
    document: vscode.TextDocument,
    range: vscode.Range
  ): string {
    return document.getText(range);
  }
}

export function deactivate() {}
