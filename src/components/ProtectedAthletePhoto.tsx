import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import type { Athlete } from '../types';

type PhotoSource = Pick<Athlete, 'id' | 'photoUrl'>;

interface ProtectedAthletePhotoProps {
  athlete: PhotoSource;
  alt: string;
  fallback: ReactNode;
  className?: string;
}

export default function ProtectedAthletePhoto({
  athlete,
  alt,
  fallback,
  className,
}: ProtectedAthletePhotoProps) {
  const [photo, setPhoto] = useState<{ athlete: PhotoSource; url: string } | null>(null);

  useEffect(() => {
    if (!athlete.photoUrl) return;
    const controller = new AbortController();
    let url = '';

    // 档案刷新时重新读取照片，更换照片后的读取地址仍相同。
    api
      .athletePhoto(athlete.id, controller.signal)
      .then((blob) => {
        if (controller.signal.aborted) return;
        url = URL.createObjectURL(blob);
        setPhoto({ athlete, url });
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhoto(null);
      });

    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [athlete]);

  if (photo?.athlete !== athlete) return fallback;
  return <img src={photo.url} alt={alt} className={className} onError={() => setPhoto(null)} />;
}
