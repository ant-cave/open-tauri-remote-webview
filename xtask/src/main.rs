use std::env;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, Instant};

use notify::{Config, EventKind, RecommendedWatcher, RecursiveMode, Watcher};

fn main() {
    let args: Vec<String> = env::args().collect();
    if args.len() < 2 {
        eprintln!("Usage: cargo xtask <command>");
        eprintln!("Available commands:");
        eprintln!("  dev  Build JS, reinstall, launch tauri dev (with file watch)");
        std::process::exit(1);
    }

    let cmd = &args[1];
    match cmd.as_str() {
        "dev" => run_dev(),
        _ => {
            eprintln!("Unknown command: {}", cmd);
            std::process::exit(1);
        }
    }
}

fn run_dev() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let guest_js = root.join("guest-js");
    let test_app = root.join("test").join("vue-app");

    build_and_install(&guest_js, &test_app);
    run_dev_watch_loop(&guest_js, &test_app);
}

fn build_and_install(guest_js: &PathBuf, test_app: &PathBuf) {
    println!("=== 1. 编译前端 JS 包 ===");
    run_cmd_blocking("npm", &["run", "build"], guest_js);

    println!("=== 2. 清除 Vite 缓存 ===");
    for dir_name in &[".vite", ".vite-temp"] {
        let cache_dir = test_app.join("node_modules").join(dir_name);
        if cache_dir.exists() {
            println!("  删除: {}", cache_dir.display());
            let _ = std::fs::remove_dir_all(&cache_dir);
        }
    }

    println!("=== 3. 重新安装前端包 ===");
    run_cmd_blocking("pnpm", &["remove", "open-tauri-remote-webview"], test_app);
    run_cmd_blocking(
        "pnpm",
        &["install", "open-tauri-remote-webview@file:../../guest-js"],
        test_app,
    );
}

// ── Watch mode ──────────────────────────────────────────────

fn run_dev_watch_loop(guest_js: &PathBuf, test_app: &PathBuf) {
    // Start file watcher
    let watch_dirs = vec![
        guest_js.join("src"),
        guest_js.join("api"),
    ];

    let (tx, rx) = mpsc::channel::<Instant>();
    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<notify::Event>| {
            if let Ok(event) = res {
                // Only care about modifications to files
                if matches!(event.kind, EventKind::Modify(_) | EventKind::Create(_) | EventKind::Remove(_)) {
                    let _ = tx.send(Instant::now());
                }
            }
        },
        Config::default(),
    )
    .expect("Failed to create file watcher");

    for dir in &watch_dirs {
        if dir.exists() {
            watcher
                .watch(dir, RecursiveMode::Recursive)
                .unwrap_or_else(|e| panic!("Failed to watch {}: {}", dir.display(), e));
            println!("  Watching: {}", dir.display());
        }
    }

    // Start tauri dev
    let mut dev_child = start_tauri_dev(test_app);

    // Debounce loop: wait for changes, then rebuild
    let debounce = Duration::from_millis(300);
    let mut last_event: Option<Instant> = None;

    loop {
        match rx.recv() {
            Ok(now) => {
                last_event = Some(now);
                // Small delay to coalesce rapid changes
                std::thread::sleep(debounce);
                // Drain any remaining events
                while rx.try_recv().is_ok() {}
                if let Some(t) = last_event {
                    if t.elapsed() >= debounce {
                        println!("\n>>> guest-js 文件发生变化，重新编译...");
                        kill_child(&mut dev_child);
                        build_and_install(guest_js, test_app);
                        dev_child = start_tauri_dev(test_app);
                        last_event = None;
                    }
                }
            }
            Err(mpsc::RecvError) => {
                eprintln!("Watcher channel closed unexpectedly.");
                break;
            }
        }
    }
}

fn start_tauri_dev(test_app: &PathBuf) -> Child {
    println!("=== 4. 启动 Tauri Dev ===");
    let program = if cfg!(windows) {
        "pnpm.cmd"
    } else {
        "pnpm"
    };

    let mut cmd = Command::new(program);
    cmd.args(["tauri", "dev"])
        .current_dir(test_app)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit());

    // On Unix, create a new process group so we can kill all descendants
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        cmd.process_group(0);
    }

    cmd.spawn()
        .expect("Failed to start pnpm tauri dev")
}

fn kill_child(child: &mut Child) {
    #[cfg(windows)]
    {
        // Use taskkill to forcefully terminate the entire process tree
        let pid = child.id();
        let _ = Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F", "/T"])
            .status();
    }

    #[cfg(unix)]
    {
        // Kill the entire process group (PGID == PID since we set process_group(0))
        let pid = child.id() as i32;
        let _ = Command::new("kill")
            .args(["-TERM", &format!("-{}", pid)])
            .status();
    }

    let _ = child.wait();
}

// ── Helper ──────────────────────────────────────────────────

fn run_cmd_blocking(cmd: &str, args: &[&str], cwd: &PathBuf) {
    let program = if cfg!(windows) {
        format!("{}.cmd", cmd)
    } else {
        cmd.to_string()
    };

    let status = Command::new(&program)
        .args(args)
        .current_dir(cwd)
        .status()
        .unwrap_or_else(|_| {
            Command::new(cmd)
                .args(args)
                .current_dir(cwd)
                .status()
                .expect(&format!("Command '{cmd}' not found. Is it installed and in PATH?"))
        });

    if !status.success() {
        panic!("Command failed: {} {:?}", cmd, args);
    }
}
