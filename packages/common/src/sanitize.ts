import { Transform } from 'class-transformer';

/** Neutralise les balises HTML (défense XSS en profondeur sur les champs texte libres). */
export function stripHtml(value: string): string {
  return value
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '') // contenu des scripts et styles retiré en entier
    .replace(/<[^>]*>/g, '')
    .replace(/[<>]/g, '')
    .trim();
}

export const Sanitize = () => Transform(({ value }) => (typeof value === 'string' ? stripHtml(value) : value));
