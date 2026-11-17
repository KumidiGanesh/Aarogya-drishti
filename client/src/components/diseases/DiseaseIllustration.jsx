const featureIllustrations = {
  'mouth-ulcers': (
    <g>
      <ellipse cx="314" cy="188" rx="20" ry="12" fill="#f2a2a0" />
      <ellipse cx="314" cy="188" rx="10" ry="5" fill="#fff5df" />
    </g>
  ),
  'oral-leukoplakia': (
    <path d="M288 176c10-15 33-18 51-9 13 7 11 19 1 26-15 10-39 7-51-1-7-5-7-11-1-16Z" fill="#fff7d9" stroke="#e0c989" strokeWidth="4" />
  ),
  'oral-erythroplakia': (
    <path d="M289 180c12-12 37-15 53-5 12 8 7 20-5 25-18 8-39 3-49-5-6-5-5-10 1-15Z" fill="#d95d69" stroke="#ff9a91" strokeWidth="4" />
  ),
  'oral-submucous-fibrosis': (
    <g fill="none" stroke="#f8d3ad" strokeLinecap="round" strokeWidth="7">
      <path d="M190 171c20 9 28 24 31 39" />
      <path d="M211 162c19 12 26 27 28 44" />
      <path d="M354 157c-9 14-13 28-11 45" />
      <path d="M374 165c-12 14-16 29-13 44" />
    </g>
  ),
  'oral-cancer': (
    <path d="M301 180c8-17 16-23 27-19 6-14 23-11 25 3 17 2 17 19 5 27-12 11-39 13-54 4-8-4-9-10-3-15Z" fill="#b94e5b" stroke="#f28a83" strokeWidth="4" />
  ),
  gingivitis: (
    <g fill="none" stroke="#e7797f" strokeLinecap="round" strokeWidth="10">
      <path d="M164 151c37-25 78-31 114-24" />
      <path d="M371 127c37-7 76 1 105 23" />
    </g>
  ),
  periodontitis: (
    <g>
      <path d="M165 153c35-21 73-25 104-18m106-7c36-5 70 3 98 22" fill="none" stroke="#e7797f" strokeLinecap="round" strokeWidth="9" />
      <path d="M243 155v22m29-27v27m30-30v30" fill="none" stroke="#b87748" strokeLinecap="round" strokeWidth="4" />
    </g>
  ),
  'tooth-decay': (
    <g>
      <circle cx="276" cy="158" r="10" fill="#9c674b" />
      <circle cx="276" cy="158" r="4" fill="#704a43" />
    </g>
  ),
  'oral-thrush': (
    <g fill="#fff8e6" stroke="#e4d7b6" strokeWidth="2">
      <ellipse cx="267" cy="202" rx="11" ry="7" />
      <ellipse cx="295" cy="211" rx="14" ry="8" />
      <ellipse cx="329" cy="205" rx="10" ry="7" />
    </g>
  ),
  'geographic-tongue': (
    <g fill="none" stroke="#f6ce8f" strokeWidth="7">
      <path d="M268 204c10-13 19-11 24-2s15 11 23 0 16-11 23-1" />
      <path d="M290 220c9-8 16-7 23 0" />
    </g>
  ),
  'oral-lichen-planus': (
    <g fill="none" stroke="#fff4dd" strokeLinecap="round" strokeWidth="3">
      <path d="m275 175 11 9-9 9 12 9m2-35 9 10-8 10 11 10m5-38 9 9-8 10 11 10" />
      <path d="m330 173 10 9-8 10 11 9" />
    </g>
  ),
  'dental-abscess': (
    <g>
      <circle cx="299" cy="183" r="16" fill="#f7b76b" opacity=".8" />
      <circle cx="299" cy="183" r="7" fill="#fff1ce" />
      <path d="M299 160v-8m-20 18-7-5m44 5 7-5" stroke="#f3a34e" strokeLinecap="round" strokeWidth="4" />
    </g>
  ),
  'cold-sores': (
    <g fill="#f8c56d" stroke="#e9837a" strokeWidth="3">
      <circle cx="154" cy="185" r="8" />
      <circle cx="168" cy="177" r="7" />
      <circle cx="168" cy="193" r="7" />
    </g>
  ),
  'burning-mouth-syndrome': (
    <g fill="none" stroke="#f0a34f" strokeLinecap="round" strokeWidth="5">
      <path d="M295 198c-14-12 8-15 0-28m20 31c-14-13 9-17 0-31m20 32c-13-11 8-16 0-27" />
    </g>
  ),
  'oral-candidiasis': (
    <g fill="#fff9e8" stroke="#e3d6b7" strokeWidth="2">
      <path d="M239 182c7-10 19-7 21 2 7-6 17 0 14 8-2 7-17 10-28 6-9-3-12-10-7-16Z" />
      <path d="M316 201c8-9 19-6 21 2 8-5 16 1 13 9-4 8-19 9-29 4-7-4-9-10-5-15Z" />
      <ellipse cx="368" cy="178" rx="12" ry="7" />
    </g>
  ),
  'proliferative-verrucous-leukoplakia': (
    <g fill="#fff5d5" stroke="#dec98f" strokeWidth="3">
      <path d="M211 172c13-12 31-9 37 2 11-9 28-3 27 9-1 12-19 18-34 15-19 4-38-11-30-26Z" />
      <path d="M331 168c11-12 29-9 34 1 11-8 27-2 26 9-1 12-17 18-32 15-18 4-35-10-28-25Z" />
    </g>
  ),
  'actinic-cheilitis': (
    <g fill="none" stroke="#bd6a67" strokeLinecap="round" strokeWidth="3">
      <path d="m241 242 7 10m19-8 5 12m19-10 7 10m20-8 5 12m19-10 7 10" />
    </g>
  ),
  'oral-lichenoid-lesions': (
    <g fill="none" stroke="#fff2dc" strokeLinecap="round" strokeWidth="4">
      <path d="M274 177c12-15 29-15 39 0s27 15 39 0" />
      <path d="M275 193c12-14 29-14 39 0s26 14 38 0" />
    </g>
  ),
  'oral-lupus-erythematosus': (
    <g>
      <path d="M294 171c12-13 35-13 47 0 12 13 2 29-19 32-22 4-40-16-28-32Z" fill="#d96c76" />
      <path d="m301 177 10 5 10-7 10 7 10-4m-36 13 11-5 10 7 10-6" fill="none" stroke="#ffe7ce" strokeLinecap="round" strokeWidth="3" />
    </g>
  ),
  'smokeless-tobacco-keratosis': (
    <path d="M174 176c15-12 35-11 47-3 10 7 8 17-3 22-13 6-32 4-43-3-7-5-7-11-1-16Z" fill="#f2e7c9" stroke="#d4c49b" strokeWidth="3" />
  ),
  'oral-hairy-leukoplakia': (
    <g fill="none" stroke="#fff2d6" strokeLinecap="round" strokeWidth="4">
      <path d="M359 173v19m8-22v25m8-22v20m8-16v14m8-18v19" />
    </g>
  ),
  'angular-cheilitis': (
    <g fill="none" stroke="#bb5863" strokeLinecap="round" strokeWidth="5">
      <path d="m145 177 13 10-12 11" />
      <path d="m151 181 8 6" stroke="#ffd0b5" strokeWidth="3" />
    </g>
  ),
  'dry-mouth-xerostomia': (
    <g fill="none" stroke="#9bc9e8" strokeLinecap="round" strokeWidth="4">
      <path d="M253 193c-8-10 2-17 8-23 5 7 14 15 7 23-4 5-11 5-15 0Z" />
      <path d="M352 199c-7-9 2-15 7-21 5 6 13 13 7 21-4 5-10 5-14 0Z" />
    </g>
  ),
  'oral-herpes': (
    <g fill="#f7c36d" stroke="#e8837b" strokeWidth="3">
      <circle cx="334" cy="192" r="7" />
      <circle cx="347" cy="186" r="6" />
      <circle cx="349" cy="201" r="6" />
      <circle cx="362" cy="194" r="5" />
    </g>
  ),
};

export default function DiseaseIllustration({ disease, alt, className }) {
  const feature = featureIllustrations[disease.id];
  if (!feature) throw new Error(`Missing educational illustration for ${disease.id}`);

  return (
    <svg
      aria-label={alt}
      className={className}
      data-disease-id={disease.id}
      preserveAspectRatio="xMidYMid slice"
      role="img"
      viewBox="0 0 640 360"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id={`disease-bg-${disease.id}`} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#f4f9ff" />
          <stop offset="1" stopColor="#dceeff" />
        </linearGradient>
        <linearGradient id={`disease-tongue-${disease.id}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#e99697" />
          <stop offset="1" stopColor="#d97d83" />
        </linearGradient>
      </defs>
      <rect fill={`url(#disease-bg-${disease.id})`} height="360" rx="28" width="640" />
      <circle cx="515" cy="73" fill="#fff" opacity=".52" r="42" />
      <circle cx="103" cy="285" fill="#fff" opacity=".38" r="54" />
      <path
        d="M67 180c69-94 164-116 253-67 89-49 184-27 253 67-69 94-164 116-253 67-89 49-184 27-253-67Z"
        fill="#e99697"
        stroke="#123b66"
        strokeLinejoin="round"
        strokeWidth="9"
      />
      <path
        d="M105 180c62-60 137-78 215-40 78-38 153-20 215 40-62 60-137 78-215 40-78 38-153 20-215-40Z"
        fill="#873f59"
      />
      <path
        d="M133 169c53-40 116-48 187-20 71-28 134-20 187 20-53-11-116-9-187 3-71-12-134-14-187-3Z"
        fill="#bc6876"
      />
      {Array.from({ length: 8 }, (_, index) => {
        const x = 168 + index * 36;
        return (
          <g key={x}>
            <path
              d={`M${x} 153q14-8 28 0l-2 22q-12 8-24 0Z`}
              fill="#fffdf5"
              stroke="#e2e8ee"
              strokeWidth="2"
            />
            <path
              d={`M${x} 207q14 8 28 0l-2-19q-12-8-24 0Z`}
              fill="#fffdf5"
              stroke="#e2e8ee"
              strokeWidth="2"
            />
          </g>
        );
      })}
      <path
        d="M244 206c23-12 66-12 91 0 22 11 22 25-3 34-28 10-67 9-88-3-15-9-15-22 0-31Z"
        fill={`url(#disease-tongue-${disease.id})`}
        stroke="#f5b2a7"
        strokeWidth="3"
      />
      <path d="M286 218c13 3 25 3 37 0" fill="none" stroke="#bb626d" strokeLinecap="round" strokeWidth="3" />
      <g data-disease-motif={disease.id}>{feature}</g>
      <path d="M462 112h92" fill="none" stroke="#7ea9ca" strokeDasharray="5 8" strokeLinecap="round" strokeWidth="3" />
      <circle cx="462" cy="112" fill="#2196f3" r="7" />
      <circle cx="556" cy="112" fill="#fff" r="7" stroke="#2196f3" strokeWidth="3" />
    </svg>
  );
}
