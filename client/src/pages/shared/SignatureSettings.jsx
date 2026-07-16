import { useState, useEffect, useRef } from 'react'
import toast from 'react-hot-toast'
import { PenTool, Upload, Trash2, Loader2, Eraser, Save } from 'lucide-react'
import PageHeader from '../../components/ui/PageHeader.jsx'
import { usersAPI } from '../../services/api.js'

const CANVAS_W = 500
const CANVAS_H = 160

// Crops the canvas down to the drawn strokes' own bounding box (plus a
// small margin) so a quick freehand signature doesn't get saved as a
// mostly-empty 500x160 image — matches the tight-crop advice already given
// for uploaded files.
function cropToContent(canvas) {
  const ctx = canvas.getContext('2d')
  const { data, width, height } = ctx.getImageData(0, 0, canvas.width, canvas.height)
  let minX = width, minY = height, maxX = -1, maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]
      if (alpha > 0) {
        if (x < minX) minX = x
        if (x > maxX) maxX = x
        if (y < minY) minY = y
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) return null   // nothing drawn
  const pad = 8
  minX = Math.max(0, minX - pad); minY = Math.max(0, minY - pad)
  maxX = Math.min(width - 1, maxX + pad); maxY = Math.min(height - 1, maxY + pad)
  const cropped = document.createElement('canvas')
  cropped.width = maxX - minX + 1
  cropped.height = maxY - minY + 1
  cropped.getContext('2d').drawImage(canvas, minX, minY, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height)
  return cropped
}

function SignaturePad({ onSave, saving }) {
  const canvasRef = useRef(null)
  const drawingRef = useRef(false)
  const [hasDrawn, setHasDrawn] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    ctx.lineWidth = 2.5
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.strokeStyle = '#1e293b'
  }, [])

  const pointerPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect()
    const scaleX = canvasRef.current.width / rect.width
    const scaleY = canvasRef.current.height / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }

  const start = (e) => {
    drawingRef.current = true
    setHasDrawn(true)
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = pointerPos(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
    canvasRef.current.setPointerCapture(e.pointerId)
  }
  const move = (e) => {
    if (!drawingRef.current) return
    const ctx = canvasRef.current.getContext('2d')
    const { x, y } = pointerPos(e)
    ctx.lineTo(x, y)
    ctx.stroke()
  }
  const end = () => { drawingRef.current = false }

  const clear = () => {
    const canvas = canvasRef.current
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height)
    setHasDrawn(false)
  }

  const save = () => {
    const cropped = cropToContent(canvasRef.current)
    if (!cropped) {
      toast.error('Draw your signature first.')
      return
    }
    onSave(cropped.toDataURL('image/png'))
  }

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={CANVAS_W}
        height={CANVAS_H}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerLeave={end}
        className="w-full border-2 border-dashed border-gray-300 rounded-xl bg-gray-50 touch-none cursor-crosshair"
        style={{ aspectRatio: `${CANVAS_W}/${CANVAS_H}` }}
      />
      <p className="text-xs text-gray-400 mt-2">Draw with your mouse, trackpad, or finger/stylus on a touch screen.</p>
      <div className="flex gap-3 mt-4">
        <button onClick={save} disabled={saving || !hasDrawn}
          className="flex-1 flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Signature
        </button>
        <button onClick={clear} disabled={saving || !hasDrawn}
          className="flex items-center gap-2 bg-white hover:bg-gray-50 border-2 border-gray-200 disabled:opacity-60 text-gray-600 font-semibold px-4 py-2.5 rounded-xl transition text-sm">
          <Eraser className="w-4 h-4" /> Clear
        </button>
      </div>
    </div>
  )
}

export default function SignatureSettings() {
  const [signature, setSignature] = useState(null)
  const [loading, setLoading]     = useState(true)
  const [saving, setSaving]       = useState(false)
  const [mode, setMode]           = useState('draw')   // 'draw' | 'upload'
  const fileInputRef = useRef(null)

  const load = () => {
    usersAPI.getSignature()
      .then(r => setSignature(r.data.signature_image))
      .catch(() => toast.error('Failed to load your signature.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const persistSignature = async (dataUri) => {
    setSaving(true)
    try {
      await usersAPI.setSignature(dataUri)
      setSignature(dataUri)
      toast.success('Signature saved. It will be attached to the Faculty Loading form once you confirm a submission.')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to save signature.')
    } finally {
      setSaving(false)
    }
  }

  const handleFileChange = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.type !== 'image/png') {
      toast.error('Please upload a PNG image (transparent background recommended).')
      return
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error('Signature image is too large (max 2MB).')
      return
    }
    const reader = new FileReader()
    reader.onload = () => persistSignature(reader.result)
    reader.readAsDataURL(file)
  }

  const handleRemove = async () => {
    if (!confirm('Remove your saved e-signature?')) return
    setSaving(true)
    try {
      await usersAPI.removeSignature()
      setSignature(null)
      toast.success('Signature removed.')
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to remove signature.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div>
      <PageHeader
        title="My E-Signature"
        subtitle="Draw or upload a signature once — it's automatically attached to the Faculty Loading DOCX for any submission you confirm."
      />

      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 max-w-xl">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400">
            <Loader2 className="w-6 h-6 animate-spin mr-2" /> Loading...
          </div>
        ) : (
          <>
            <div className="border-2 border-dashed border-gray-200 rounded-xl flex items-center justify-center py-10 mb-5 bg-gray-50">
              {signature ? (
                <img src={signature} alt="Your signature" className="max-h-24 max-w-full" />
              ) : (
                <div className="text-center text-gray-400">
                  <PenTool className="w-10 h-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">No signature saved yet.</p>
                </div>
              )}
            </div>

            {signature && (
              <button onClick={handleRemove} disabled={saving}
                className="w-full mb-5 flex items-center justify-center gap-2 bg-white hover:bg-red-50 border-2 border-gray-200 hover:border-red-300 text-gray-600 hover:text-red-600 font-semibold py-2 rounded-xl transition text-sm">
                <Trash2 className="w-4 h-4" /> Remove Current Signature
              </button>
            )}

            <div className="flex border-2 border-gray-200 rounded-xl overflow-hidden mb-5">
              <button onClick={() => setMode('draw')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition ${mode === 'draw' ? 'bg-green-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                <PenTool className="w-4 h-4" /> Draw Signature
              </button>
              <button onClick={() => setMode('upload')}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 text-sm font-semibold transition ${mode === 'upload' ? 'bg-green-700 text-white' : 'bg-white text-gray-500 hover:bg-gray-50'}`}>
                <Upload className="w-4 h-4" /> Upload Image
              </button>
            </div>

            {mode === 'draw' ? (
              <SignaturePad onSave={persistSignature} saving={saving} />
            ) : (
              <>
                <input ref={fileInputRef} type="file" accept="image/png" className="hidden" onChange={handleFileChange} />
                <button onClick={() => fileInputRef.current?.click()} disabled={saving}
                  className="w-full flex items-center justify-center gap-2 bg-green-700 hover:bg-green-800 disabled:opacity-60 text-white font-bold py-2.5 rounded-xl transition text-sm">
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                  {signature ? 'Replace Signature' : 'Upload Signature'}
                </button>
                <p className="text-xs text-gray-400 mt-3">
                  PNG only, transparent background recommended, max 2MB. Crop it tightly around the signature itself for the best fit on the form.
                </p>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
