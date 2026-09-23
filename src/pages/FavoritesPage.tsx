import { useState } from 'react'
import { Star, ImageIcon, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

const initialFavorites = [
  { id: 1, name: '国潮插画_系列', type: 'image', time: '2026-09-18' },
  { id: 2, name: '产品主图_白底', type: 'image', time: '2026-09-16' },
]

export default function FavoritesPage() {
  const { t } = useTranslation()
  const [favorites, setFavorites] = useState(initialFavorites)

  const handleDelete = (id: number) => {
    if (!confirm(t('pages.favorites.confirmDelete'))) return
    setFavorites((prev) => prev.filter((f) => f.id !== id))
  }

  return (
    <div className="flex h-full flex-col bg-bg">
      <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1320px] p-6 pt-0">
      <h3 className="mb-4 text-[18px] font-bold leading-[26px] text-text">{t('pages.favorites.title')}</h3>
      {favorites.length === 0 ? (
        <div className="rounded-xl bg-card p-16 text-center text-[14px] text-text-muted">
          {t('pages.favorites.empty')}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {favorites.map((f) => (
            <div key={f.id} className="group relative overflow-hidden rounded-xl bg-card transition-colors hover:bg-card-hover">
              <div className="flex aspect-square items-center justify-center">
                <ImageIcon className="size-8 text-text-muted" />
              </div>
              <div className="flex items-center justify-between p-3">
                <div className="min-w-0">
                  <div className="truncate text-[14px] text-text">{f.name}</div>
                  <div className="mt-0.5 text-[12px] text-text-muted">{f.time}</div>
                </div>
                <Star className="size-4 shrink-0 fill-accent text-accent" />
              </div>
              <button
                onClick={() => handleDelete(f.id)}
                title={t("pages.favorites.deleteTitle")}
                className="absolute right-2 top-2 hidden size-7 items-center justify-center rounded-lg bg-black/50 text-white backdrop-blur hover:bg-red-500 group-hover:flex"
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      </div>
      </div>
    </div>
  )
}
