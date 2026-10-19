use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;
use uuid::Uuid;

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Chapter {
    pub id: String,
    pub title: String,
    pub document: Value,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Card {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub text: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Scene {
    pub id: String,
    pub chapter_id: Option<String>,
    pub title: String,
    pub text: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Event {
    pub id: String,
    pub when: String,
    pub title: String,
    pub text: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Attachment {
    pub id: String,
    pub name: String,
    pub path: String,
    pub sha256: String,
}

#[derive(Clone, Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Project {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub chapters: Vec<Chapter>,
    pub cards: Vec<Card>,
    pub scenes: Vec<Scene>,
    pub events: Vec<Event>,
    pub attachments: Vec<Attachment>,
}

pub fn id() -> String {
    Uuid::new_v4().to_string()
}
pub fn new_project(title: String) -> Project {
    Project {
        schema_version: 1,
        id: id(),
        title,
        chapters: vec![Chapter {
            id: id(),
            title: "Глава 1".into(),
            document: serde_json::json!({"type":"doc","content":[{"type":"paragraph"}]}),
        }],
        cards: vec![],
        scenes: vec![],
        events: vec![],
        attachments: vec![],
    }
}

pub fn validate(p: &Project) -> Result<(), String> {
    if p.schema_version != 1 {
        return Err("Эта версия проекта не поддерживается. Исходный файл не изменён.".into());
    }
    let mut ids = HashSet::new();
    for s in std::iter::once(&p.id)
        .chain(p.chapters.iter().map(|x| &x.id))
        .chain(p.cards.iter().map(|x| &x.id))
        .chain(p.scenes.iter().map(|x| &x.id))
        .chain(p.events.iter().map(|x| &x.id))
        .chain(p.attachments.iter().map(|x| &x.id))
    {
        if Uuid::parse_str(s).is_err() || !ids.insert(s) {
            return Err("Повреждённые или повторяющиеся идентификаторы проекта.".into());
        }
    }
    if p.title.trim().is_empty()
        || p.title.len() > 1000
        || p.chapters.is_empty()
        || p.chapters.len() > 10000
    {
        return Err("Некорректное название или число глав.".into());
    }
    for c in &p.chapters {
        validate_document(&c.document, 0)?;
    }
    for c in &p.cards {
        if !["character", "world", "note"].contains(&c.kind.as_str()) {
            return Err("Неизвестный тип материала.".into());
        }
    }
    for s in &p.scenes {
        if let Some(id) = &s.chapter_id {
            if !p.chapters.iter().any(|c| &c.id == id) {
                return Err("Сцена ссылается на отсутствующую главу.".into());
            }
        }
    }
    for a in &p.attachments {
        let expected = format!("assets/{}", a.id);
        if a.path != expected
            || a.sha256.len() != 64
            || !a.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Недопустимый путь или сумма вложения.".into());
        }
    }
    Ok(())
}

fn validate_document(v: &Value, depth: usize) -> Result<(), String> {
    if depth > 100 {
        return Err("Слишком глубокая вложенность текста.".into());
    }
    let t = v
        .get("type")
        .and_then(Value::as_str)
        .ok_or("Неверный формат главы.")?;
    if (depth == 0 && t != "doc")
        || ![
            "doc",
            "paragraph",
            "text",
            "heading",
            "blockquote",
            "bulletList",
            "orderedList",
            "listItem",
            "hardBreak",
            "horizontalRule",
            "codeBlock",
        ]
        .contains(&t)
    {
        return Err(format!("Неподдерживаемый элемент главы: {t}"));
    }
    if t == "text" && !v.get("text").is_some_and(Value::is_string) {
        return Err("Текстовый элемент повреждён.".into());
    }
    if let Some(a) = v.get("attrs") {
        let attrs = a.as_object().ok_or("Некорректные атрибуты текста.")?;
        for (key, val) in attrs {
            let valid = match key.as_str() {
                "textAlign" => {
                    val.is_null()
                        || val
                            .as_str()
                            .is_some_and(|s| ["left", "center", "right", "justify"].contains(&s))
                }
                "level" => val.as_u64().is_some_and(|n| (1..=3).contains(&n)),
                "start" => val.as_u64().is_some_and(|n| (1..=1000000).contains(&n)),
                "type" | "language" => val.is_null() || val.is_string(),
                _ => false,
            };
            if !valid {
                return Err(format!("Неподдерживаемое оформление: {key}"));
            }
        }
    }
    if let Some(marks) = v.get("marks") {
        if t != "text" {
            return Err("Оформление допустимо только для текста.".into());
        }
        for m in marks.as_array().ok_or("Некорректное оформление текста.")?
        {
            if !m
                .get("type")
                .and_then(Value::as_str)
                .is_some_and(|s| ["bold", "italic", "underline", "strike", "code"].contains(&s))
            {
                return Err("Неподдерживаемое оформление текста.".into());
            }
        }
    }
    let children = v
        .get("content")
        .map(|c| c.as_array().ok_or("Некорректное содержимое главы."))
        .transpose()?;
    if ["doc", "blockquote", "bulletList", "orderedList", "listItem"].contains(&t)
        && children.is_none_or(|c| c.is_empty())
    {
        return Err("Пустой структурный элемент главы.".into());
    }
    if let Some(children) = children {
        for (i, child) in children.iter().enumerate() {
            let child_type = child["type"].as_str().unwrap_or("");
            let allowed = match t {
                "paragraph" | "heading" => ["text", "hardBreak"].contains(&child_type),
                "codeBlock" => child_type == "text",
                "bulletList" | "orderedList" => child_type == "listItem",
                "listItem" if i == 0 => child_type == "paragraph",
                "doc" | "blockquote" | "listItem" => [
                    "paragraph",
                    "heading",
                    "blockquote",
                    "bulletList",
                    "orderedList",
                    "codeBlock",
                    "horizontalRule",
                ]
                .contains(&child_type),
                _ => false,
            };
            if !allowed {
                return Err("Нарушена структура главы. Исходный файл не изменён.".into());
            }
            validate_document(child, depth + 1)?;
        }
    }
    Ok(())
}

pub fn escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}
pub fn html(v: &Value) -> String {
    let t = v["type"].as_str().unwrap_or("");
    if t == "text" {
        let mut s = escape(v["text"].as_str().unwrap_or(""));
        if let Some(marks) = v["marks"].as_array() {
            for m in marks {
                let tag = match m["type"].as_str().unwrap_or("") {
                    "bold" => "strong",
                    "italic" => "em",
                    "underline" => "u",
                    "strike" => "s",
                    "code" => "code",
                    _ => continue,
                };
                s = format!("<{tag}>{s}</{tag}>");
            }
        }
        return s;
    }
    let content = v["content"]
        .as_array()
        .map(|a| a.iter().map(html).collect::<String>())
        .unwrap_or_default();
    let tag = match t {
        "doc" => return content,
        "paragraph" => "p".into(),
        "heading" => format!("h{}", v["attrs"]["level"].as_u64().unwrap_or(2)),
        "blockquote" => "blockquote".into(),
        "bulletList" => "ul".into(),
        "orderedList" => "ol".into(),
        "listItem" => "li".into(),
        "hardBreak" => return "<br>".into(),
        "horizontalRule" => return "<hr>".into(),
        "codeBlock" => "pre".into(),
        _ => return content,
    };
    let align = v["attrs"]["textAlign"]
        .as_str()
        .map(|s| format!(" style=\"text-align:{s}\""))
        .unwrap_or_default();
    let start = if t == "orderedList" {
        v["attrs"]["start"]
            .as_u64()
            .map(|n| format!(" start=\"{n}\""))
            .unwrap_or_default()
    } else {
        String::new()
    };
    format!("<{tag}{align}{start}>{content}</{tag}>")
}

pub fn manuscript_html(p: &Project) -> String {
    let chapters: String = p
        .chapters
        .iter()
        .map(|c| format!("<h1>{}</h1>{}", escape(&c.title), html(&c.document)))
        .collect();
    format!("<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\"><title>{}</title></head><body>{chapters}</body></html>", escape(&p.title))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn refuses_data_that_editor_would_drop() {
        let mut p = new_project("Книга".into());
        p.chapters[0].document =
            serde_json::json!({"type":"doc","content":[{"type":"text","text":"Иначе потеряется"}]});
        assert!(validate(&p).is_err());
        p.chapters[0].document = serde_json::json!({"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"<script>","marks":[{"type":"bold"}]}]}]});
        validate(&p).unwrap();
        assert!(!manuscript_html(&p).contains("<script>"));
    }
}
