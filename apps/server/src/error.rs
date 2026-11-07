//! One typed error for the whole API. Every failure maps to a stable machine-readable `code`
//! and a human message; the JSON shape is `{"error": "...", "code": "..."}` (the `error`
//! field is what existing web/mobile clients already read).
use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{0}")]
    Unauthorized(String),
    #[error("Insufficient permissions")]
    Forbidden,
    #[error("CSRF check failed")]
    Csrf,
    #[error("{0}")]
    NotFound(String),
    #[error("{0}")]
    Conflict(String),
    #[error("{0}")]
    Gone(String),
    #[error("{0}")]
    TooManyRequests(String),
    #[error("Database operation failed")]
    Database(#[source] sqlx::Error),
    #[error("{0}")]
    Internal(String),
}

impl ApiError {
    pub fn status(&self) -> StatusCode {
        match self {
            Self::BadRequest(_) => StatusCode::BAD_REQUEST,
            Self::Unauthorized(_) => StatusCode::UNAUTHORIZED,
            Self::Forbidden | Self::Csrf => StatusCode::FORBIDDEN,
            Self::NotFound(_) => StatusCode::NOT_FOUND,
            Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Gone(_) => StatusCode::GONE,
            Self::TooManyRequests(_) => StatusCode::TOO_MANY_REQUESTS,
            Self::Database(_) | Self::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        }
    }
    pub fn code(&self) -> &'static str {
        match self {
            Self::BadRequest(_) => "bad_request",
            Self::Unauthorized(_) => "unauthorized",
            Self::Forbidden => "forbidden",
            Self::Csrf => "csrf",
            Self::NotFound(_) => "not_found",
            Self::Conflict(_) => "conflict",
            Self::Gone(_) => "gone",
            Self::TooManyRequests(_) => "rate_limited",
            Self::Database(_) | Self::Internal(_) => "internal",
        }
    }
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ErrorBody {
    pub error: String,
    pub code: &'static str,
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if let Self::Database(e) = &self {
            tracing::error!(error=%e, "database operation failed");
        }
        let body = ErrorBody {
            error: self.to_string(),
            code: self.code(),
        };
        (self.status(), Json(body)).into_response()
    }
}

pub type ApiResult<T> = Result<T, ApiError>;

/// Build an error from a status code (used where the status is chosen dynamically).
pub fn err(status: StatusCode, msg: &str) -> ApiError {
    let m = msg.to_string();
    match status {
        StatusCode::BAD_REQUEST => ApiError::BadRequest(m),
        StatusCode::UNAUTHORIZED => ApiError::Unauthorized(m),
        StatusCode::FORBIDDEN => ApiError::Forbidden,
        StatusCode::NOT_FOUND => ApiError::NotFound(m),
        StatusCode::CONFLICT => ApiError::Conflict(m),
        StatusCode::GONE => ApiError::Gone(m),
        StatusCode::TOO_MANY_REQUESTS => ApiError::TooManyRequests(m),
        _ => ApiError::Internal(m),
    }
}
pub fn db_err(e: sqlx::Error) -> ApiError {
    ApiError::Database(e)
}
pub fn bad(msg: &str) -> ApiError {
    ApiError::BadRequest(msg.into())
}
pub fn forbidden() -> ApiError {
    ApiError::Forbidden
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn statuses_and_codes_are_stable() {
        assert_eq!(bad("x").status(), StatusCode::BAD_REQUEST);
        assert_eq!(bad("x").code(), "bad_request");
        assert_eq!(forbidden().status(), StatusCode::FORBIDDEN);
        assert_eq!(err(StatusCode::NOT_FOUND, "n").code(), "not_found");
        assert_eq!(
            err(StatusCode::CONFLICT, "c").status(),
            StatusCode::CONFLICT
        );
        assert_eq!(err(StatusCode::IM_A_TEAPOT, "t").code(), "internal");
    }

    #[test]
    fn database_errors_do_not_leak_details() {
        let e = db_err(sqlx::Error::RowNotFound);
        assert_eq!(e.to_string(), "Database operation failed");
    }
}
