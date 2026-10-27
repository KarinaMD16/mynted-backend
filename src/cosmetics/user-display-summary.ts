import { EffectiveAsset } from './cosmetic-resolve';

// Lo mínimo que necesita un listado para pintar a una persona: el badge Pro y
// el marco del avatar. Sin banner ni ganso (eso solo importa en el perfil).
export interface UserDisplaySummary {
  isPro: boolean;
  // Marco efectivo: el equipado si el usuario tiene derecho a usarlo y, si no,
  // el marco por defecto. Siempre presente (los gratuitos también equipan
  // marcos gratuitos).
  frame: EffectiveAsset;
}

// Cuando el cargador no devuelve a alguien (no debería pasar: responde una
// entrada por cada id pedido), se pinta como un usuario gratuito sin marco.
export const FALLBACK_USER_DISPLAY: UserDisplaySummary = {
  isPro: false,
  frame: { code: 'frame_default', assetUrl: null },
};
