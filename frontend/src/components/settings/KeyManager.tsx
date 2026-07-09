import { useState, type FormEvent } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { KeyInfo } from '@/hooks/useSettings'

interface Props {
  keys: KeyInfo[]
  onGenerate: (name: string, type: KeyInfo['type'], bits: number) => void
  onImport: (name: string, privateKey: string) => void
  onDelete: (id: string) => void
  onExport: (id: string) => void
}

export function KeyManager({ keys, onGenerate, onImport, onDelete, onExport }: Props) {
  const [showGenerate, setShowGenerate] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [genName, setGenName] = useState('')
  const [genType, setGenType] = useState<string>('ed25519')
  const [genBits, setGenBits] = useState('256')
  const [importName, setImportName] = useState('')
  const [importKey, setImportKey] = useState('')

  const handleGenerate = (e: FormEvent) => {
    e.preventDefault()
    onGenerate(genName, genType as KeyInfo['type'], parseInt(genBits, 10) || 256)
    setShowGenerate(false)
    setGenName('')
  }

  const handleImport = (e: FormEvent) => {
    e.preventDefault()
    onImport(importName, importKey)
    setShowImport(false)
    setImportName('')
    setImportKey('')
  }

  const typeLabel = (t: string) => {
    switch (t) {
      case 'rsa': return 'RSA'
      case 'ed25519': return 'Ed25519'
      case 'ecdsa': return 'ECDSA'
      default: return t
    }
  }

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setShowGenerate(true)}>
          生成
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowImport(true)}>
          导入
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>类型</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {keys.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                无密钥
              </TableCell>
            </TableRow>
          ) : (
            keys.map((key) => (
              <TableRow key={key.id}>
                <TableCell>{key.name}</TableCell>
                <TableCell>{typeLabel(key.type)} ({key.bits})</TableCell>
                <TableCell className="text-xs">
                  {key.createdAt}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button size="xs" variant="ghost" onClick={() => onExport(key.id)}>
                      导出
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      className="text-destructive"
                      onClick={() => onDelete(key.id)}
                    >
                      删除
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <Dialog open={showGenerate} onOpenChange={setShowGenerate}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>生成密钥</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleGenerate} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                名称
              </label>
              <Input value={genName} onChange={(e) => setGenName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                类型
              </label>
              <Select value={genType} onValueChange={(value) => setGenType(value ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="rsa">RSA</SelectItem>
                  <SelectItem value="ed25519">Ed25519</SelectItem>
                  <SelectItem value="ecdsa">ECDSA</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                位数
              </label>
              <Select value={genBits} onValueChange={(value) => setGenBits(value ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="256">256</SelectItem>
                  <SelectItem value="384">384</SelectItem>
                  <SelectItem value="521">521</SelectItem>
                  <SelectItem value="2048">2048 (RSA)</SelectItem>
                  <SelectItem value="4096">4096 (RSA)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <DialogFooter showCloseButton>
              <Button type="submit">生成</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showImport} onOpenChange={setShowImport}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>导入密钥</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleImport} className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                名称
              </label>
              <Input value={importName} onChange={(e) => setImportName(e.target.value)} required />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                私钥内容
              </label>
              <textarea
                className="min-h-[120px] w-full rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                value={importKey}
                onChange={(e) => setImportKey(e.target.value)}
                required
              />
            </div>
            <DialogFooter showCloseButton>
              <Button type="submit">导入</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
