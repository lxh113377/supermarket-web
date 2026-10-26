//! 分块流式响应体。
//!
//! 为什么需要自己实现 `http_body::Body`：axum/hyper 的 `Body::from(Bytes)` 是**单帧**，
//! 整个壳会等全部生成完才写出去；而首屏的收益恰恰来自「head 与 hero 先到，浏览器可以
//! 边收边解析（提前发现 preload/字体/样式）」。`Body::from_stream` 需要一个 Stream 实现，
//! 那要么引 `futures-util`/`async-stream`，要么 30 行手写 —— 这里选手写：
//! 「每 poll 一次交一帧」就够了，hyper 会把每一帧独立写出去（TCP_NODELAY 默认开）。
//!
//! 注意：这不改变响应字节（`Content-Length` 由 `size_hint` 精确给出，浏览器仍可显示进度），
//! 只是把「写出去的时机」提前 —— 所以它是**零语义代价**的首屏优化。

use bytes::Bytes;
use http_body::{Body, Frame, SizeHint};
use std::collections::VecDeque;
use std::pin::Pin;
use std::task::{Context, Poll};

pub struct ChunkedBody {
    chunks: VecDeque<Bytes>,
}

impl ChunkedBody {
    pub fn new(chunks: Vec<Bytes>) -> Self {
        ChunkedBody { chunks: chunks.into() }
    }
}

impl Body for ChunkedBody {
    type Data = Bytes;
    type Error = std::io::Error;

    fn poll_frame(
        self: Pin<&mut Self>,
        _cx: &mut Context<'_>,
    ) -> Poll<Option<Result<Frame<Self::Data>, Self::Error>>> {
        let this = self.get_mut();
        Poll::Ready(this.chunks.pop_front().map(|b| Ok(Frame::data(b))))
    }

    fn size_hint(&self) -> SizeHint {
        let total: usize = self.chunks.iter().map(|b| b.len()).sum();
        SizeHint::with_exact(total as u64)
    }
}
