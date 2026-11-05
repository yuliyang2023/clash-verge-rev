use std::{
    net::{IpAddr, TcpListener, UdpSocket},
    process::{Child, Command, Stdio},
    sync::Mutex,
    time::Duration,
};

use super::{CmdResult, CommandFailure};

static GLIDER: Mutex<Option<Child>> = Mutex::new(None);

#[tauri::command]
#[specta::specta]
pub fn glider_status() -> CmdResult<bool> {
    let mut child = GLIDER.lock().map_err(CommandFailure::plain)?;
    if let Some(process) = child.as_mut() {
        if process.try_wait().map_err(CommandFailure::plain)?.is_none() {
            return Ok(true);
        }
    }
    *child = None;
    Ok(false)
}

#[tauri::command]
#[specta::specta]
pub fn start_glider(listen_port: u16, target_ip: std::string::String, target_port: u16) -> CmdResult<()> {
    if listen_port == 0 || target_port == 0 {
        return Err(CommandFailure::plain("Ports must be between 1 and 65535"));
    }
    let ip: IpAddr = target_ip.parse().map_err(CommandFailure::plain)?;
    let mut child = GLIDER.lock().map_err(CommandFailure::plain)?;
    if let Some(process) = child.as_mut() {
        if process.try_wait().map_err(CommandFailure::plain)?.is_none() {
            return Err(CommandFailure::plain("Glider is already running"));
        }
    }
    let path = crate::utils::dirs::app_resources_dir()
        .map_err(CommandFailure::plain)?
        .join(if cfg!(windows) { "glider.exe" } else { "glider" });
    if !path.exists() {
        return Err(CommandFailure::plain("Glider is not bundled for this architecture"));
    }
    let tcp = TcpListener::bind(("0.0.0.0", listen_port))
        .map_err(|error| CommandFailure::plain(format!("Cannot listen on TCP port {listen_port}: {error}")))?;
    let udp = UdpSocket::bind(("0.0.0.0", listen_port))
        .map_err(|error| CommandFailure::plain(format!("Cannot listen on UDP port {listen_port}: {error}")))?;
    drop((tcp, udp));
    let mut command = Command::new(path);
    command
        .args([
            "-listen",
            &format!("socks5://:{listen_port}"),
            "-forward",
            &format!("socks5://{}", std::net::SocketAddr::new(ip, target_port)),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
    let mut process = command.spawn().map_err(CommandFailure::plain)?;
    std::thread::sleep(Duration::from_millis(300));
    if let Some(status) = process.try_wait().map_err(CommandFailure::plain)? {
        return Err(CommandFailure::plain(format!("Glider exited during startup: {status}")));
    }
    *child = Some(process);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn stop_glider() -> CmdResult<()> {
    let mut child = GLIDER.lock().map_err(CommandFailure::plain)?;
    if let Some(process) = child.as_mut() {
        if process.try_wait().map_err(CommandFailure::plain)?.is_none() {
            process.kill().map_err(CommandFailure::plain)?;
            process.wait().map_err(CommandFailure::plain)?;
        }
    }
    *child = None;
    Ok(())
}
