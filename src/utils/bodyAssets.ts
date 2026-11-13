import { WardrobeAsset } from '../types/body';

export const INITIAL_WARDROBE_ASSETS: WardrobeAsset[] = [
  {
    id: 'asset-blazer-navy',
    name: 'Tailored Midnight Blazer',
    category: 'clothing',
    subCategory: 'blazer',
    imageUrl: '/src/assets/images/asset_tailored_blazer_1794417020215.jpg',
    anchorPoint: 'shoulders',
    defaultScale: 1.0,
    tags: ['Formal', 'Luxury Wool', 'Structured Lapel'],
    brand: 'Atelier Sartorial',
    fabricType: 'wool',
  },
  {
    id: 'asset-costume-kimono',
    name: 'Embroidered Royal Silk Kimono',
    category: 'clothing',
    subCategory: 'robe',
    imageUrl: '/src/assets/images/costume_silk_kimono_1794472960844.jpg',
    anchorPoint: 'shoulders',
    defaultScale: 1.15,
    tags: ['Costume', 'Crimson Silk', 'Gold Phoenix Embroidery', 'Flowing Hem'],
    brand: 'Kyoto Imperial Silk',
    fabricType: 'silk',
  },
  {
    id: 'asset-costume-emerald',
    name: 'Royal Emerald & Platinum Pendant',
    category: 'jewelry',
    subCategory: 'necklace',
    imageUrl: '/src/assets/images/costume_emerald_pendant_1794472974484.jpg',
    anchorPoint: 'neck',
    defaultScale: 0.62,
    tags: ['Colombian Emerald', 'Halo Pave', 'Platinum Chain'],
    brand: 'Imperial Crown Jewels',
  },
  {
    id: 'asset-necklace-diamond',
    name: 'Solitaire Diamond Pendant',
    category: 'jewelry',
    subCategory: 'necklace',
    imageUrl: '/src/assets/images/asset_gold_necklace_1794417020572.jpg',
    anchorPoint: 'neck',
    defaultScale: 0.65,
    tags: ['18K Gold', 'Pave Diamond', 'Collarbone Fit'],
    brand: 'Maison Haute',
  },
  {
    id: 'asset-watch-chrono',
    name: 'Chronograph Steel & Gold Watch',
    category: 'jewelry',
    subCategory: 'watch',
    imageUrl: '/src/assets/images/asset_luxury_watch_1794417021558.jpg',
    anchorPoint: 'wrist',
    defaultScale: 0.38,
    tags: ['Swiss Automatic', 'Two-Tone', 'Tachymeter'],
    brand: 'Geneva Horology',
  },
];

const CUSTOM_ASSETS_KEY = 'facestudio_custom_wardrobe_v2';

export function loadSavedCustomAssets(): WardrobeAsset[] {
  try {
    const raw = localStorage.getItem(CUSTOM_ASSETS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('Failed to load custom wardrobe assets:', err);
    return [];
  }
}

export function saveCustomAssetsToStorage(assets: WardrobeAsset[]): void {
  try {
    const customOnly = assets.filter((a) => a.isCustom);
    localStorage.setItem(CUSTOM_ASSETS_KEY, JSON.stringify(customOnly));
  } catch (err) {
    console.warn('Failed to save custom wardrobe assets:', err);
  }
}
