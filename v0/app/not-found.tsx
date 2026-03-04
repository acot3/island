export default function NotFound() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Arial, sans-serif',
      padding: '20px',
      textAlign: 'center'
    }}>
      <h2 style={{ fontSize: '32px', marginBottom: '16px', color: '#333' }}>
        404
      </h2>
      <p style={{ fontSize: '18px', color: '#666', marginBottom: '24px' }}>
        Page not found
      </p>
      <a
        href="/"
        style={{
          padding: '12px 24px',
          fontSize: '16px',
          backgroundColor: '#4CAF50',
          color: 'white',
          textDecoration: 'none',
          borderRadius: '6px',
          display: 'inline-block'
        }}
      >
        Go home
      </a>
    </div>
  );
}





