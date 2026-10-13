import { Transform } from 'class-transformer';

/** Neutralise les balises HTML dans les champs texte libres. */
export function stripHtml(value: string): string {
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '') // retire le contenu des scripts et styles
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .trim();
}

export const Sanitize = () => Transform(({ value }) => (typeof value === 'string' ? stripHtml(value) : value));
