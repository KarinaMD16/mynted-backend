// Versión estática de un banner animado: el primer fotograma. Cloudinary
// entrega el primer fotograma de una imagen animada cuando se pide en un
// formato sin animación, así que basta cambiar la extensión de la URL a .jpg
// (validado con un GIF animado real en la cuenta de Cloudinary: el .jpg es
// idéntico a pg_1 y distinto del segundo fotograma). No se guarda nada: se
// deriva al leer.
const CLOUDINARY_DELIVERY = '/image/upload/';
const ANIMATED_EXTENSION = /\.(gif|webp|apng)(?=$|\?)/i;

export function toStaticImageUrl(url: string, isAnimated: boolean): string {
  if (!isAnimated || !url.includes(CLOUDINARY_DELIVERY)) return url;
  return url.replace(ANIMATED_EXTENSION, '.jpg');
}
