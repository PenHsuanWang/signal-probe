import React, { useCallback, useRef, useState } from 'react';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { uploadSignal } from '../lib/api';
import type { SignalMetadata } from '../types/signal';

interface FileUploaderProps {
  onUploadComplete: (signal: SignalMetadata) => void;
}

export default function FileUploader({ onUploadComplete }: FileUploaderProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    async (file: File) => {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !['csv', 'parquet', 'pq'].includes(ext)) {
        setError('Only .csv and .parquet files are supported');
        return;
      }
      setIsUploading(true);
      setError(null);
      setSuccess(null);
      try {
        const signal = await uploadSignal(file);
        setSuccess(`"${file.name}" uploaded — processing started`);
        onUploadComplete(signal);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Upload failed';
        setError((err as { response?: { data?: { detail?: string } } })?.response?.data?.detail ?? msg);
      } finally {
        setIsUploading(false);
        if (inputRef.current) inputRef.current.value = '';
      }
    },
    [onUploadComplete]
  );

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="space-y-3">
      <div
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer transition-colors
          ${isDragging
            ? 'border-brand-500 bg-brand-500/10'
            : 'border-zinc-700 hover:border-zinc-500 bg-zinc-900'
          }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".csv,.parquet,.pq"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
          }}
        />
        {isUploading ? (
          <div className="flex flex-col items-center space-y-2">
            <div className="animate-spin rounded-full h-8 w-8 border-2 border-brand-500 border-t-transparent" />
            <p className="text-sm font-mono text-zinc-400">Uploading…</p>
          </div>
        ) : (
          <>
            <Upload className="h-8 w-8 text-zinc-500 mb-2" />
            <p className="text-sm font-mono text-zinc-300">
              Drop a <span className="text-brand-400">.csv</span> or{' '}
              <span className="text-brand-400">.parquet</span> file here
            </p>
            <p className="text-xs font-mono text-zinc-500 mt-1">or click to browse · max 100 MB</p>
          </>
        )}
      </div>

      {error && (
        <div className="flex items-center space-x-2 text-red-400 text-sm font-mono">
          <AlertCircle size={14} />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-center space-x-2 text-green-400 text-sm font-mono">
          <CheckCircle size={14} />
          <span>{success}</span>
        </div>
      )}
    </div>
  );
}
