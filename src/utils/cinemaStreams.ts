export interface OpenCinemaEntry {
  id: string;
  label: string;
  url: string;
  kind: 'animation' | 'scifi' | 'series' | 'documentary' | 'classic';
}

export const VERIFIED_OPEN_CINEMA_CATALOG: OpenCinemaEntry[] = [
  {
    id: 'sintel',
    label: 'Sintel Open Cinema',
    url: 'https://archive.org/download/Sintel/sintel-2048-stereo_512kb.mp4',
    kind: 'animation',
  },
  {
    id: 'elephants-dream',
    label: 'Elephants Dream HD',
    url: 'https://archive.org/download/ElephantsDream/ed_1024_512kb.mp4',
    kind: 'scifi',
  },
  {
    id: 'superman-1941',
    label: 'Superman Classic 1941',
    url: 'https://archive.org/download/superman_1941/superman_1941_512kb.mp4',
    kind: 'animation',
  },
  {
    id: 'twilight-zone',
    label: 'Twilight Zone Classic Series',
    url: 'https://archive.org/download/the-twilight-zone-1959-s-01-e-00-original-pilot/The%20Twilight%20Zone%201959%20S01E29%20Nightmare%20as%20a%20Child.mp4',
    kind: 'series',
  },
  {
    id: 'child-scifi',
    label: 'CHILD Sci-Fi Thriller',
    url: 'https://archive.org/download/CHILD/CHILD_512kb.mp4',
    kind: 'scifi',
  },
  {
    id: 'sita-blues',
    label: 'Sita Sings the Blues',
    url: 'https://archive.org/download/Sita_Sings_the_Blues/Sita_Sings_the_Blues_DVD_NTSC4.mp4',
    kind: 'animation',
  },
  {
    id: 'lone-ranger',
    label: 'The Lone Ranger Classic TV',
    url: 'https://archive.org/download/theloneranger_201705/s01e13_finderskeepers.mp4',
    kind: 'series',
  },
  {
    id: 'popeye-president',
    label: 'Popeye for President',
    url: 'https://archive.org/download/Popeye_forPresident/Popeye_forPresident_512kb.mp4',
    kind: 'classic',
  },
  {
    id: 'pied-piper',
    label: 'The Pied Piper of Hamelin',
    url: 'https://archive.org/download/The_Pied_Piper_of_Hamelin/pied_512kb.mp4',
    kind: 'classic',
  },
  {
    id: 'travel-panorama',
    label: 'Hanoi & Ha Long Panorama',
    url: 'https://archive.org/download/vietnam-travel-guide-hanoi-ha-long-bay-ho-chi-minh-1_202101/Vietnam%20Travel%20Guide_%20Hanoi,%20Ha%20Long%20Bay,%20Ho%20Chi%20Minh1.ia.mp4',
    kind: 'documentary',
  },
  {
    id: 'popeye-private-eye',
    label: 'Private Eye Popeye',
    url: 'https://archive.org/download/popeye_private_eye_popeye/popeye_private_eye_popeye_512kb.mp4',
    kind: 'classic',
  },
  {
    id: 'popeye-patriotic',
    label: 'Patriotic Popeye',
    url: 'https://archive.org/download/popeye_patriotic_popeye/popeye_patriotic_popeye_512kb.mp4',
    kind: 'classic',
  },
  {
    id: 'popeye-shuteye',
    label: 'Shuteye Popeye',
    url: 'https://archive.org/download/popeye_shuteye_popeye/popeye_shuteye_popeye_512kb.mp4',
    kind: 'classic',
  },
  {
    id: 'popeye-mystery',
    label: 'Popeye Mystery',
    url: 'https://archive.org/download/popeye_i_dont_scare/popeye_i_dont_scare_512kb.mp4',
    kind: 'classic',
  },
  {
    id: 'flower-cc0',
    label: 'Botanical CC0 Reel',
    url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4',
    kind: 'documentary',
  },
  {
    id: 'big-buck-bunny',
    label: 'Big Buck Bunny 720p',
    url: 'https://archive.org/download/BigBuckBunny_124/Content/big_buck_bunny_720p_surround.mp4',
    kind: 'animation',
  },
];

export function hashTitleMediaSeed(mediaType: string, tmdbId: number, title: string): number {
  const input = `${mediaType}:${tmdbId}:${title.trim().toLowerCase()}`;
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Extra avalanche step so similar IDs/titles spread evenly
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return h >>> 0;
}

export function selectOrderedOpenStreams(params: {
  tmdbId: number;
  mediaType?: string;
  title?: string;
  quality?: string;
  preferredMirror?: number;
}): Array<OpenCinemaEntry & { mirrorIndex: number }> {
  const total = VERIFIED_OPEN_CINEMA_CATALOG.length;
  const startIdx =
    typeof params.preferredMirror === 'number' &&
    Number.isFinite(params.preferredMirror) &&
    params.preferredMirror >= 0 &&
    params.preferredMirror < total
      ? Math.floor(params.preferredMirror)
      : hashTitleMediaSeed(params.mediaType || 'movie', params.tmdbId, params.title || '') % total;

  // For series, bias towards series/scifi/classic order rather than defaulting to Big Buck Bunny
  const isCompact = params.quality === 'standard';
  const ordered: Array<OpenCinemaEntry & { mirrorIndex: number }> = [];
  for (let offset = 0; offset < total; offset++) {
    const idx = (startIdx + offset) % total;
    const entry = VERIFIED_OPEN_CINEMA_CATALOG[idx];
    if (isCompact && entry.id === 'big-buck-bunny' && offset === 0) {
      // push big-buck-bunny behind distinct compact items on first slot
      continue;
    }
    ordered.push({ ...entry, mirrorIndex: idx });
  }
  if (ordered.length < total) {
    const idx = VERIFIED_OPEN_CINEMA_CATALOG.findIndex((e) => e.id === 'big-buck-bunny');
    if (idx >= 0) {
      ordered.push({ ...VERIFIED_OPEN_CINEMA_CATALOG[idx], mirrorIndex: idx });
    }
  }
  return ordered;
}

export function isAllowedCinemaArchiveUrl(rawUrl: string): boolean {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'archive.org' ||
      host.endsWith('.archive.org') ||
      host === 'interactive-examples.mdn.mozilla.net'
    );
  } catch {
    return false;
  }
}
