import React from 'react';

// One line-icon set for the whole app — no emoji anywhere in the UI.
// Everything is drawn on the same 24 grid with a 1.8 stroke so icons sitting
// next to each other in a toolbar look like siblings.
const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

const Icon = ({ size = 18, children, ...rest }) => (
  <svg {...base} width={size} height={size} {...rest}>{children}</svg>
);

export const ImageIcon = (p) => (
  <Icon {...p}>
    <rect x="3" y="4" width="18" height="16" rx="2.5" />
    <circle cx="8.5" cy="9.5" r="1.6" />
    <path d="M21 16.5 16 11l-5.5 6" />
    <path d="M3 18.5 7.5 14l2.6 2.6" />
  </Icon>
);

export const TagIcon = (p) => (
  <Icon {...p}>
    <path d="M20.6 13.4 12.4 21.6a2 2 0 0 1-2.8 0l-7.2-7.2a2 2 0 0 1-.6-1.5l.3-7.1a2 2 0 0 1 1.9-1.9l7.1-.3a2 2 0 0 1 1.5.6l7.2 7.2a2 2 0 0 1 0 2.8z" />
    <circle cx="7.6" cy="7.6" r="1.3" />
  </Icon>
);

export const StarIcon = ({ filled, ...p }) => (
  <Icon {...p} fill={filled ? 'currentColor' : 'none'}>
    <path d="M12 3.7l2.6 5.2 5.8.9-4.2 4.1 1 5.7-5.2-2.7-5.2 2.7 1-5.7-4.2-4.1 5.8-.9z" />
  </Icon>
);

export const PencilIcon = (p) => (
  <Icon {...p}>
    <path d="M4 20h4L18 10a2.1 2.1 0 0 0-3-3L5 17z" />
    <path d="M13.5 6.5l3 3" />
  </Icon>
);

export const ClockIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 1.8" />
  </Icon>
);

export const CheckIcon = (p) => (
  <Icon {...p}>
    <path d="M4.5 12.5 9.5 17.5 19.5 6.5" />
  </Icon>
);

export const CheckboxIcon = (p) => (
  <Icon {...p}>
    <rect x="3.5" y="3.5" width="17" height="17" rx="3.5" />
    <path d="M7.5 12.3 10.6 15.4 16.5 9.2" />
  </Icon>
);

export const AlertIcon = (p) => (
  <Icon {...p}>
    <path d="M12 4.5 21 20H3z" />
    <path d="M12 10v4" />
    <circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none" />
  </Icon>
);

export const BookIcon = (p) => (
  <Icon {...p}>
    <path d="M2 4h6a4 4 0 0 1 4 4v12a3 3 0 0 0-3-3H2z" />
    <path d="M22 4h-6a4 4 0 0 0-4 4v12a3 3 0 0 1 3-3h7z" />
  </Icon>
);

export const CommentIcon = (p) => (
  <Icon {...p}>
    <path d="M20.5 15a2.5 2.5 0 0 1-2.5 2.5H8L4 21V5.5A2.5 2.5 0 0 1 6.5 3H18a2.5 2.5 0 0 1 2.5 2.5z" />
  </Icon>
);

export const SearchIcon = (p) => (
  <Icon {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="M16.2 16.2 21 21" />
  </Icon>
);

export const CameraIcon = (p) => (
  <Icon {...p}>
    <path d="M3 8.5h3.5L8.5 6h7l2 2.5H21a1 1 0 0 1 1 1V19a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V9.5a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13.5" r="3.6" />
  </Icon>
);

export const ClipboardIcon = (p) => (
  <Icon {...p}>
    <path d="M9 4.5h6a1 1 0 0 1 1 1v1H8v-1a1 1 0 0 1 1-1z" />
    <path d="M8 6H6a1.5 1.5 0 0 0-1.5 1.5v12A1.5 1.5 0 0 0 6 21h12a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 18 6h-2" />
  </Icon>
);

export const FolderIcon = (p) => (
  <Icon {...p}>
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5H19.5A1.5 1.5 0 0 1 21 10v8a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18z" />
  </Icon>
);

export const CapIcon = (p) => (
  <Icon {...p}>
    <path d="M12 4 22 9l-10 5L2 9z" />
    <path d="M6 11.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5" />
  </Icon>
);

export const BulbIcon = (p) => (
  <Icon {...p}>
    <path d="M9.5 17.5h5" />
    <path d="M10 20.5h4" />
    <path d="M12 3.5a5.5 5.5 0 0 0-3.2 10c.5.4.8.9.9 1.5h4.6c.1-.6.4-1.1.9-1.5A5.5 5.5 0 0 0 12 3.5z" />
  </Icon>
);

export const TargetIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.9" fill="currentColor" stroke="none" />
  </Icon>
);

export const DownloadIcon = (p) => (
  <Icon {...p}>
    <path d="M12 3.5v11" />
    <path d="M7.5 10 12 14.5 16.5 10" />
    <path d="M4.5 19.5h15" />
  </Icon>
);

export const UploadIcon = (p) => (
  <Icon {...p}>
    <path d="M12 14.5v-11" />
    <path d="M7.5 8 12 3.5 16.5 8" />
    <path d="M4.5 19.5h15" />
  </Icon>
);

export const SoundOnIcon = (p) => (
  <Icon {...p}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
    <path d="M19.07 4.93a10 10 0 0 1 0 14.14" />
  </Icon>
);

export const SoundOffIcon = (p) => (
  <Icon {...p}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M23 9 17 15" />
    <path d="M17 9 23 15" />
  </Icon>
);

export const VolumeIcon = (p) => (
  <Icon {...p}>
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <path d="M15.54 8.46a5 5 0 0 1 0 7.07" />
  </Icon>
);

export const SkipStartIcon = (p) => (
  <Icon {...p}>
    <path d="M18.5 5.5v13L8 12z" fill="currentColor" stroke="none" />
    <path d="M6 5.5v13" />
  </Icon>
);

export const SkipEndIcon = (p) => (
  <Icon {...p}>
    <path d="M5.5 5.5v13L16 12z" fill="currentColor" stroke="none" />
    <path d="M18 5.5v13" />
  </Icon>
);

export const PrevIcon = (p) => (
  <Icon {...p}>
    <path d="M15 5.5 8 12l7 6.5" />
  </Icon>
);

export const NextIcon = (p) => (
  <Icon {...p}>
    <path d="M9 5.5 16 12l-7 6.5" />
  </Icon>
);

export const PlayIcon = (p) => (
  <Icon {...p}>
    <path d="M7.5 4.8 19 12 7.5 19.2z" fill="currentColor" stroke="none" />
  </Icon>
);

export const ShuffleIcon = (p) => (
  <Icon {...p}>
    <path d="M3 7h4l10 10h4" />
    <path d="M3 17h4L17 7h4" />
    <path d="M18.5 4.5 21 7l-2.5 2.5" />
    <path d="M18.5 14.5 21 17l-2.5 2.5" />
  </Icon>
);

export const GearIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.2 14.6a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-1-1.4 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.4-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.4 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.4 1z" />
  </Icon>
);

export const PawnIcon = (p) => (
  <Icon {...p}>
    <circle cx="12" cy="7" r="3" />
    <path d="M9.2 10.2c0 2-1.2 2.8-1.2 4.3h8c0-1.5-1.2-2.3-1.2-4.3" />
    <path d="M8 14.5c0 3-1 4-1.5 5.5h11c-.5-1.5-1.5-2.5-1.5-5.5" />
  </Icon>
);
