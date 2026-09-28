import { useEffect, useState } from 'react';

interface ProtectedAthletePhotoProps {
  athleteId: number;
  photoUrl: string;
  alt: string;
  className?: string;
}

export default function ProtectedAthletePhoto({
  athleteId,
  photoUrl,
  alt,
  className,
}: ProtectedAthletePhotoProps) {
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!photoUrl) return;
    let revoked = false;
    let objectUrl = '';

    async function fetchPhoto() {
      try {
        const token = localStorage.getItem('token');
        const response = await fetch(photoUrl, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) throw new Error('photo fetch failed');
        const blob = await response.blob();
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
        setError(false);
      } catch {
        if (!revoked) setError(true);
      }
    }

    fetchPhoto();
    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [athleteId, photoUrl]);

  if (error || !blobUrl) return null;
  return <img src={blobUrl} alt={alt} className={className} />;
}
