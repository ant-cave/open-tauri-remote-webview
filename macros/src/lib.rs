use proc_macro::TokenStream;
use proc_macro2::Span;
use quote::quote;
use syn::{FnArg, Ident, ItemFn, PatType, ReturnType};

/// Annotate a `#[tauri::command]` function to generate a remote invocation
/// wrapper (`__orui_wrap__<fn_name>`) for WebSocket access without a WebView.
///
/// Stack with `#[tauri::command]`:
/// ```ignore
/// #[tauri::command]
/// #[remote_command]
/// fn my_cmd(value: String) -> String { value }
/// ```
///
/// Then in setup():
/// ```ignore
/// register_remote_commands!(app, [my_cmd]);
/// ```
#[proc_macro_attribute]
pub fn remote_command(_attr: TokenStream, item: TokenStream) -> TokenStream {
    let func: ItemFn = syn::parse(item.clone()).expect("remote_command: failed to parse function");
    let fn_name = &func.sig.ident;
    let fn_name_str = fn_name.to_string();
    let vis = &func.vis;
    let attrs = &func.attrs;
    let is_async = func.sig.asyncness.is_some();
    let has_result = returns_result(&func.sig.output);

    let wrap_ident = Ident::new(&format!("__orui_wrap__{}", fn_name_str), fn_name.span());

    let user_args: Vec<&PatType> = func
        .sig
        .inputs
        .iter()
        .filter_map(|arg| {
            if let FnArg::Typed(pt) = arg {
                let ts = quote!(#pt.ty).to_string();
                let skip = ts == "tauri :: AppHandle"
                    || ts == "AppHandle"
                    || ts.contains("Webview")
                    || ts.contains("Window")
                    || ts.starts_with("State ");
                if skip {
                    None
                } else {
                    Some(pt)
                }
            } else {
                None
            }
        })
        .collect();

    let arg_names: Vec<_> = user_args
        .iter()
        .map(|pt| {
            if let syn::Pat::Ident(pi) = pt.pat.as_ref() {
                pi.ident.clone()
            } else {
                unreachable!()
            }
        })
        .collect();
    let arg_types: Vec<_> = user_args.iter().map(|pt| &pt.ty).collect();

    let call_args: Vec<_> = arg_names.iter().map(|n| quote! { args_typed.#n }).collect();
    let call = if call_args.is_empty() {
        quote! { #fn_name() }
    } else {
        quote! { #fn_name(#(#call_args),*) }
    };

    let wrapper = if has_result {
        // Function returns Result<T, E>
        if is_async {
            quote! {
                #[doc(hidden)]
                fn #wrap_ident(args: Option<::serde_json::Value>) -> Result<::serde_json::Value, String> {
                    #[derive(::serde::Deserialize)]
                    struct __OruiArgs { #( #arg_names: #arg_types, )* }
                    let args_typed: __OruiArgs = ::serde_json::from_value(
                        args.unwrap_or(::serde_json::Value::Null)
                    ).map_err(|e| format!("failed to deserialize args for '{}': {}", #fn_name_str, e))?;
                    let __val = ::tauri::async_runtime::block_on(async { #call.await })
                        .map_err(|e| e.to_string())?;
                    Ok(::serde_json::to_value(__val).unwrap_or(::serde_json::Value::Null))
                }
            }
        } else {
            quote! {
                #[doc(hidden)]
                fn #wrap_ident(args: Option<::serde_json::Value>) -> Result<::serde_json::Value, String> {
                    #[derive(::serde::Deserialize)]
                    struct __OruiArgs { #( #arg_names: #arg_types, )* }
                    let args_typed: __OruiArgs = ::serde_json::from_value(
                        args.unwrap_or(::serde_json::Value::Null)
                    ).map_err(|e| format!("failed to deserialize args for '{}': {}", #fn_name_str, e))?;
                    let __val = #call.map_err(|e| e.to_string())?;
                    Ok(::serde_json::to_value(__val).unwrap_or(::serde_json::Value::Null))
                }
            }
        }
    } else {
        // Function returns plain T
        if is_async {
            quote! {
                #[doc(hidden)]
                fn #wrap_ident(args: Option<::serde_json::Value>) -> Result<::serde_json::Value, String> {
                    #[derive(::serde::Deserialize)]
                    struct __OruiArgs { #( #arg_names: #arg_types, )* }
                    let args_typed: __OruiArgs = ::serde_json::from_value(
                        args.unwrap_or(::serde_json::Value::Null)
                    ).map_err(|e| format!("failed to deserialize args for '{}': {}", #fn_name_str, e))?;
                    let __val = { ::tauri::async_runtime::block_on(async { #call.await }); };
                    Ok(::serde_json::to_value(__val).unwrap_or(::serde_json::Value::Null))
                }
            }
        } else {
            quote! {
                #[doc(hidden)]
                fn #wrap_ident(args: Option<::serde_json::Value>) -> Result<::serde_json::Value, String> {
                    #[derive(::serde::Deserialize)]
                    struct __OruiArgs { #( #arg_names: #arg_types, )* }
                    let args_typed: __OruiArgs = ::serde_json::from_value(
                        args.unwrap_or(::serde_json::Value::Null)
                    ).map_err(|e| format!("failed to deserialize args for '{}': {}", #fn_name_str, e))?;
                    let __val = #call;
                    Ok(::serde_json::to_value(__val).unwrap_or(::serde_json::Value::Null))
                }
            }
        }
    };

    let expanded = quote! { #(#attrs)* #vis #func #wrapper };
    expanded.into()
}

fn returns_result(output: &ReturnType) -> bool {
    match output {
        ReturnType::Default => false,
        ReturnType::Type(_, ty) => {
            let s = quote!(#ty).to_string();
            s.starts_with("Result ")
                || s.starts_with("Result<")
                || s.starts_with("std::result::Result ")
                || s.starts_with("std::result::Result<")
        }
    }
}

#[proc_macro]
pub fn register_remote_commands(input: TokenStream) -> TokenStream {
    let tokens: Vec<_> = input.into_iter().collect();
    let mut i = 0;
    if i >= tokens.len() {
        return quote! {}.into();
    }
    i += 1; // skip app ident
    if i < tokens.len() {
        if let proc_macro::TokenTree::Punct(p) = &tokens[i] {
            if p.as_char() == ',' {
                i += 1;
            }
        }
    }
    let group = match tokens.get(i) {
        Some(proc_macro::TokenTree::Group(g))
            if g.delimiter() == proc_macro::Delimiter::Bracket =>
        {
            g.stream()
        }
        _ => return quote! {}.into(),
    };

    let mut cmds = Vec::new();
    for tt in group {
        match tt {
            proc_macro::TokenTree::Ident(id) => cmds.push(id.to_string()),
            _ => {}
        }
    }

    let regs: Vec<_> = cmds
        .iter()
        .map(|name| {
            let w = Ident::new(&format!("__orui_wrap__{}", name), Span::call_site());
            quote! { registry.register(#name, |args| { #w(args) }); }
        })
        .collect();

    quote! { { use tauri::Manager; let registry = app.state::<open_tauri_remote_webview::CommandRegistry>(); #(#regs)* } }.into()
}
