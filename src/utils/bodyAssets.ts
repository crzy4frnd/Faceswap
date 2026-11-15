import { WardrobeAsset } from '../types/body';
import blazerUrl from '../assets/images/asset_tailored_blazer_1794417020215.jpg';
import kimonoUrl from '../assets/images/costume_silk_kimono_1794472960844.jpg';
import emeraldPendantUrl from '../assets/images/costume_emerald_pendant_1794472974484.jpg';
import goldNecklaceUrl from '../assets/images/asset_gold_necklace_1794417020572.jpg';
import watchChronoUrl from '../assets/images/asset_luxury_watch_1794417021558.jpg';

export interface ClothingTagDef {
  id: string;
  label: string;
  defaultAnchor: WardrobeAsset['anchorPoint'];
  defaultFabric: NonNullable<WardrobeAsset['fabricType']>;
  defaultScale: number;
}

export const BUILTIN_CLOTHING_TAGS: ClothingTagDef[] = [
  { id: 'suit', label: 'Suits', defaultAnchor: 'shoulders', defaultFabric: 'wool', defaultScale: 1.04 },
  { id: 'shirt', label: 'Shirts', defaultAnchor: 'shoulders', defaultFabric: 'cotton', defaultScale: 1.0 },
  { id: 'bikini', label: 'Bikini', defaultAnchor: 'chest', defaultFabric: 'silk', defaultScale: 0.88 },
  { id: 'dress', label: 'Dresses', defaultAnchor: 'shoulders', defaultFabric: 'silk', defaultScale: 1.05 },
  { id: 'jacket', label: 'Jackets', defaultAnchor: 'shoulders', defaultFabric: 'leather', defaultScale: 1.06 },
  { id: 'robe', label: 'Robes', defaultAnchor: 'shoulders', defaultFabric: 'silk', defaultScale: 1.12 },
  { id: 'skirt', label: 'Skirts', defaultAnchor: 'waist', defaultFabric: 'cotton', defaultScale: 1.0 },
  { id: 'pants', label: 'Pants', defaultAnchor: 'waist', defaultFabric: 'cotton', defaultScale: 1.0 },
];

export const INITIAL_WARDROBE_ASSETS: WardrobeAsset[] = [
  {
    id: 'asset-blazer-navy',
    name: 'Tailored Midnight Blazer',
    category: 'clothing',
    subCategory: 'suit',
    clothingTag: 'suit',
    imageUrl: blazerUrl,
    anchorPoint: 'shoulders',
    defaultScale: 1.0,
    tags: ['Suits', 'Formal', 'Luxury Wool', 'Structured Lapel'],
    brand: 'Atelier Sartorial',
    fabricType: 'wool',
  },
  {
    id: 'asset-costume-kimono',
    name: 'Embroidered Royal Silk Kimono',
    category: 'clothing',
    subCategory: 'robe',
    clothingTag: 'robe',
    imageUrl: kimonoUrl,
    anchorPoint: 'shoulders',
    defaultScale: 1.12,
    tags: ['Robes', 'Costume', 'Crimson Silk', 'Flowing Hem'],
    brand: 'Kyoto Imperial Silk',
    fabricType: 'silk',
  },
  {
    id: 'asset-costume-emerald',
    name: 'Royal Emerald & Platinum Pendant',
    category: 'jewelry',
    subCategory: 'necklace',
    imageUrl: emeraldPendantUrl,
    anchorPoint: 'neck',
    defaultScale: 0.62,
    tags: ['Necklace', 'Colombian Emerald', 'Platinum Chain'],
    brand: 'Imperial Crown Jewels',
  },
  {
    id: 'asset-necklace-diamond',
    name: 'Solitaire Diamond Pendant',
    category: 'jewelry',
    subCategory: 'necklace',
    imageUrl: goldNecklaceUrl,
    anchorPoint: 'neck',
    defaultScale: 0.65,
    tags: ['Necklace', '18K Gold', 'Pave Diamond'],
    brand: 'Maison Haute',
  },
  {
    id: 'asset-watch-chrono',
    name: 'Chronograph Steel & Gold Watch',
    category: 'jewelry',
    subCategory: 'watch',
    imageUrl: watchChronoUrl,
    anchorPoint: 'wrist',
    defaultScale: 0.38,
    tags: ['Watch', 'Swiss Automatic', 'Two-Tone'],
    brand: 'Geneva Horology',
  },
];

const CUSTOM_ASSETS_KEY = 'facestudio_custom_wardrobe_v2';
const CUSTOM_CLOTHING_TAGS_KEY = 'facestudio_custom_clothing_tags_v1';

export function normalizeTagId(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function getAssetClothingTagId(asset: WardrobeAsset): string {
  const raw = (asset.clothingTag || asset.subCategory || 'shirt').toLowerCase().trim();
  if (raw === 'blazer' || raw === 'suits' || raw === 'tuxedo') return 'suit';
  if (raw === 'top' || raw === 'tops' || raw === 't-shirt' || raw === 'tshirt' || raw === 'shirts' || raw === 'blouse') {
    return 'shirt';
  }
  if (raw === 'bikinis' || raw === 'swimwear' || raw === 'swimsuit') return 'bikini';
  if (raw === 'dresses' || raw === 'gown') return 'dress';
  if (raw === 'jackets' || raw === 'coat' || raw === 'hoodie') return 'jacket';
  if (raw === 'robes' || raw === 'kimono') return 'robe';
  if (raw === 'skirts') return 'skirt';
  if (raw === 'trousers' || raw === 'jeans') return 'pants';
  return normalizeTagId(raw) || 'shirt';
}

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

export function loadSavedCustomClothingTags(): ClothingTagDef[] {
  try {
    const raw = localStorage.getItem(CUSTOM_CLOTHING_TAGS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveCustomClothingTagsToStorage(tags: ClothingTagDef[]): void {
  try {
    localStorage.setItem(CUSTOM_CLOTHING_TAGS_KEY, JSON.stringify(tags));
  } catch {
    // ignore storage quota errors
  }
}
