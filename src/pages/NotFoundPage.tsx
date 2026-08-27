import { useNavigate } from 'react-router-dom'
import { IconEmpty } from '../components/Icons'

export default function NotFoundPage() {
  const navigate = useNavigate()

  return (
    <div className="page-container min-h-screen flex flex-col items-center justify-center p-6 text-center">
      <div className="relative mb-6">
        <div className="w-20 h-20 rounded-full brand-bar opacity-25" />
        <div className="absolute inset-0 flex items-center justify-center text-gray-500">
          <IconEmpty className="w-9 h-9" />
        </div>
      </div>
      <p className="text-5xl font-black tracking-tight text-gray-200 select-none">404</p>
      <h1 className="mt-2 text-lg font-bold text-gray-900">页面走丢了</h1>
      <p className="mt-1 text-sm text-gray-400">这个地址不存在，可能已被移动或删除。</p>
      <button
        onClick={() => navigate('/')}
        className="mt-6 bg-brand-500 text-white px-6 py-2.5 rounded-xl text-sm font-medium
                   hover:bg-brand-600 transition-all duration-200 active:scale-[0.97]"
      >
        返回首页
      </button>
    </div>
  )
}