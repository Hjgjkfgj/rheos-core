// Génération documentaire par templates (D10). Variables {{path.to.value}}
// résolues depuis un contexte (ex. {{employee.first_name}}). Avant génération,
// on CONTRÔLE les données requises : si une variable manque, on refuse
// (« impossible : information manquante ») — jamais de document à trou.

const PATH_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function get(obj: any, path: string): unknown {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/// Variables référencées par un template.
export function templateVariables(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(PATH_RE)) out.add(m[1]);
  return [...out];
}

/// Variables requises absentes/vides dans le contexte.
export function missingVariables(template: string, context: Record<string, any>): string[] {
  return templateVariables(template).filter((p) => {
    const v = get(context, p);
    return v === undefined || v === null || v === "";
  });
}

export class MissingTemplateDataError extends Error {
  constructor(public missing: string[]) {
    super(`impossible : information manquante (${missing.join(", ")})`);
  }
}

/// Rend le template. Lève MissingTemplateDataError si une variable requise manque.
export function renderTemplate(template: string, context: Record<string, any>): string {
  const missing = missingVariables(template, context);
  if (missing.length) throw new MissingTemplateDataError(missing);
  return template.replace(PATH_RE, (_, path) => String(get(context, path)));
}
