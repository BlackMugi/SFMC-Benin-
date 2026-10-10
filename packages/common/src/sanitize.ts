import { Transform } from 'class-transformer';

/** Neutralise les balises HTML (défense XSS en profondeur sur les champs texte libres). */
export function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/[<>]/g, '').trim();
}

export const Sanitize = () => Transform(({ value }) => (typeof value === 'string' ? stripHtml(value) : value));
