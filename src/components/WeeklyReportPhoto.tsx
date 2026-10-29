import { useEffect, useState } from 'react';
import { api } from '../api';
type Props = { id: string; index: number };
export function WeeklyReportPhoto({ id, index }: Props) {
  const [state, setState] = useState<{ url?: string; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    let url: string | undefined;
    api
      .weeklyPhotoBlob(id, controller.signal)
      .then((blob) => {
        if (!controller.signal.aborted) {
          url = URL.createObjectURL(blob);
          setState({ url });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setState({ error: '照片暂时无法显示' });
      });
    return () => {
      controller.abort();
      if (url) URL.revokeObjectURL(url);
    };
  }, [id]);
  return state.url ? (
    <img src={state.url} alt={`训练照片 ${index + 1}`} loading="lazy" />
  ) : (
    <p role="status">{state.error || '正在加载照片…'}</p>
  );
}
